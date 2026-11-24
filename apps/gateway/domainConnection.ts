import type { Server, Socket } from "socket.io"
import { configuredServiceUrl, serviceOrigin, type ServiceName } from "../shared/runtime/internalHttp"
import type { ServiceRelay } from "../shared/runtime/relay"
import type { GatewaySlot, RelayHandlers, SocketCommand } from "../shared/runtime/socketProtocol"
import type { PlanSlug } from "../shared/subscription/planCatalog"
import { DomainRelayLink } from "./domainRelayLink"
import { socketSnapshot } from "./socketState"

export type ClientAck = (...args: unknown[]) => void

type SocketBinding = {
    link: DomainRelayLink
    relay: ServiceRelay
    ready: Promise<void>
    revision: number
    renewal?: Promise<void>
}

function relayOrigins(name: ServiceName, slot?: GatewaySlot): URL[] {
    const setting = slot && name !== "AUTH" && process.env[`PLAYTIME_${name}_RELAY_URLS`]
    if (!setting) return [configuredServiceUrl(name)]
    const origins = setting.split(",").map((value) => serviceOrigin(value.trim(), `PLAYTIME_${name}_RELAY_URLS`))
    if (origins.length !== 2 || origins[0].origin === origins[1].origin) {
        throw new Error(`PLAYTIME_${name}_RELAY_URLS requires two distinct service origins`)
    }
    return origins
}

export class DomainConnection {
    private readonly links: DomainRelayLink[]
    private readonly connections = new WeakMap<Socket, SocketBinding>()
    private readonly attached = new WeakSet<Socket>()
    private readonly detaching = new Set<Promise<unknown>>()
    private active?: DomainRelayLink

    constructor(
        private readonly name: ServiceName,
        io: Server,
        handlers: RelayHandlers,
        onLinkLost: () => void,
        slot?: GatewaySlot
    ) {
        const origins = relayOrigins(name, slot)
        const multiple = origins.length > 1
        this.links = origins.map(
            (origin) =>
                new DomainRelayLink(
                    name,
                    origin,
                    handlers,
                    () => {
                        if (!multiple) {
                            for (const socket of io.sockets.sockets.values())
                                this.connect(socket).catch(() => undefined)
                        }
                    },
                    (wasManaged) => {
                        if (!wasManaged && !this.selected()) onLinkLost()
                    },
                    slot,
                    multiple
                )
        )
    }

    get connected(): boolean {
        return this.selected() !== undefined
    }

    get multiGateway(): boolean {
        return this.selected()?.multiGateway === true
    }

    get readyReplicas(): number {
        return this.links.filter((link) => link.accepting && link.managed).length
    }

    private selected(): DomainRelayLink | undefined {
        if (!this.active?.accepting || !this.active.managed) {
            this.active =
                this.links.find((link) => link.accepting && link.managed) ?? this.links.find((link) => link.accepting)
        }
        return this.active
    }

    start(): void {
        for (const link of this.links) link.start()
    }

    publishPlan(userId: number, planSlug: PlanSlug): boolean {
        const link = this.selected()
        if (!link?.multiGateway || !link.relay) return false
        link.relay.notify("gateway:planChanged", userId, planSlug)
        return true
    }

    async stop(): Promise<void> {
        await Promise.allSettled(this.detaching)
        for (const link of this.links) link.stop()
    }

    async connect(socket: Socket): Promise<void> {
        await this.readyBinding(socket)
    }

    private bind(socket: Socket, link: DomainRelayLink, relay: ServiceRelay): SocketBinding {
        const snapshot = socketSnapshot(socket)
        const method = link.managed && this.attached.has(socket) ? "socket:attach" : "socket:connect"
        const binding: SocketBinding = {
            link,
            relay,
            revision: snapshot.sessionRevision,
            ready: relay
                .request(method, snapshot)
                .then(() => {
                    this.attached.add(socket)
                })
                .catch((error) => {
                    if (this.connections.get(socket) === binding) this.connections.delete(socket)
                    throw error
                })
        }
        this.connections.set(socket, binding)
        return binding
    }

    private async readyBinding(socket: Socket): Promise<SocketBinding> {
        while (socket.connected) {
            const link = this.selected()
            const relay = link?.relay
            if (!link || !relay) break
            const existing = this.connections.get(socket)
            if (existing && existing.relay !== relay) await existing.ready.catch(() => undefined)
            if (!socket.connected || this.selected()?.relay !== relay) continue
            const current = this.connections.get(socket)
            const binding = current?.relay === relay ? current : this.bind(socket, link, relay)
            try {
                await binding.ready
            } catch (error) {
                if (link.accepting && link.relay === relay) throw error
                continue
            }
            if (socket.connected && link.accepting && link.relay === relay) return binding
        }
        throw new Error("Service unavailable")
    }

    private async syncSession(socket: Socket, binding: SocketBinding): Promise<void> {
        while (binding.revision < (socket.data.sessionRevision ?? 0)) {
            if (!binding.link.accepting || binding.link.relay !== binding.relay) return
            if (!binding.renewal) {
                const snapshot = socketSnapshot(socket)
                binding.renewal = binding.relay
                    .request("socket:refresh", snapshot)
                    .then(() => {
                        binding.revision = snapshot.sessionRevision
                    })
                    .finally(() => {
                        binding.renewal = undefined
                    })
            }
            try {
                await binding.renewal
            } catch (error) {
                if (binding.link.accepting && binding.link.relay === binding.relay) throw error
                return
            }
        }
    }

    async refreshSession(socket: Socket): Promise<void> {
        const binding = await this.readyBinding(socket)
        await this.syncSession(socket, binding)
    }

    async dispatch(socket: Socket, event: string, args: unknown[], acknowledge?: ClientAck): Promise<void> {
        while (socket.connected) {
            const binding = await this.readyBinding(socket)
            if (this.name === "ROOM") await this.syncSession(socket, binding)
            const { link, relay } = binding
            if (!socket.connected) break
            if (!link.accepting || link.relay !== relay) continue
            const state = socketSnapshot(socket)
            const command: SocketCommand = { event, args, expectsAck: !!acknowledge }
            if (acknowledge) {
                await relay.requestWithReply(
                    "socket:dispatch",
                    (response) => {
                        if (response) acknowledge(...response)
                    },
                    state,
                    command
                )
            } else await relay.request("socket:dispatch", state, command)
            return
        }
        throw new Error("Service unavailable")
    }

    syncRooms(socket: Socket): void {
        const binding = this.connections.get(socket)
        if (binding?.link.accepting) binding.relay.notify("socket:rooms", socketSnapshot(socket))
    }

    leaving(socket: Socket): void {
        const binding = this.connections.get(socket)
        const snapshot = socketSnapshot(socket)
        const active = this.selected()
        if (active?.managed || binding?.link.managed) {
            const cleanup = (async () => {
                await binding?.ready.catch(() => undefined)
                const link = this.selected()
                if (link?.managed) await link.relay?.request("socket:detach", snapshot)
            })().catch(() => console.error("Domain socket cleanup unavailable", this.name))
            this.detaching.add(cleanup)
            void cleanup.finally(() => this.detaching.delete(cleanup))
        } else binding?.relay.notify("socket:leaving", snapshot)
    }

    disconnect(socket: Socket): void {
        const binding = this.connections.get(socket)
        this.connections.delete(socket)
        if (binding && !binding.link.managed) binding.relay.notify("socket:disconnect", socket.id)
    }
}
