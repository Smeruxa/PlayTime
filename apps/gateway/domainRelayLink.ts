import WebSocket from "ws"
import {
    gatewayCredential,
    gatewayCredentialHeader,
    internalHeader,
    internalSecret,
    type ServiceName
} from "../shared/runtime/internalHttp"
import { maxRelayPayload, ServiceRelay } from "../shared/runtime/relay"
import {
    domainReplicaHeader,
    gatewaySlotHeader,
    multiGatewayRelayVersion,
    relayVersionHeader,
    type GatewaySlot,
    type RelayHandlers
} from "../shared/runtime/socketProtocol"

export class DomainRelayLink {
    relay?: ServiceRelay
    multiGateway = false
    managed = false
    draining = false
    private managedReady = false
    private peer?: WebSocket
    private closed = false
    private retry?: ReturnType<typeof setTimeout>

    constructor(
        private readonly name: ServiceName,
        private readonly origin: URL,
        private readonly handlers: RelayHandlers,
        private readonly opened: () => void,
        private readonly lost: (wasManaged: boolean) => void,
        private readonly slot?: GatewaySlot,
        private readonly replicas = false
    ) {}

    get accepting(): boolean {
        return !this.draining && this.relay?.connected === true && (!this.managed || this.managedReady)
    }

    start(): void {
        if (this.closed) return
        const url = new URL("/internal/gateway", this.origin)
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
        const peer = new WebSocket(url, {
            headers: {
                [internalHeader]: internalSecret(),
                [gatewayCredentialHeader]: gatewayCredential(this.name, "socket"),
                [relayVersionHeader]: multiGatewayRelayVersion,
                ...(this.slot ? { [gatewaySlotHeader]: this.slot } : {}),
                ...(this.replicas ? { [domainReplicaHeader]: "1" } : {})
            },
            maxPayload: maxRelayPayload,
            handshakeTimeout: 5000
        })
        this.peer = peer
        this.draining = false
        this.managedReady = false
        peer.once("upgrade", (response) => {
            this.multiGateway = response.headers[relayVersionHeader] === multiGatewayRelayVersion
            this.managed = this.replicas && response.headers[domainReplicaHeader] === "1"
        })
        peer.on("error", () => peer.terminate())
        peer.once("open", () => {
            if (this.closed) return peer.close()
            const relay = new ServiceRelay(peer, {
                ...this.handlers,
                "domain:ready": () => {
                    this.managedReady = this.managed
                },
                "domain:drain": async () => {
                    if (!this.managed) throw new Error("Domain relay does not support draining")
                    this.draining = true
                    await relay.waitForReplies()
                }
            })
            this.relay = relay
            this.opened()
        })
        peer.once("close", () => {
            if (this.peer !== peer) return
            const wasLinked = this.relay !== undefined
            this.relay = undefined
            if (!this.closed) {
                if (wasLinked) this.lost(this.managed)
                this.retry = setTimeout(() => this.start(), 500).unref()
            }
        })
    }

    stop(): void {
        this.closed = true
        clearTimeout(this.retry)
        this.peer?.terminate()
    }
}
