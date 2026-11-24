import type { Server as HttpServer } from "node:http"
import { WebSocketServer, type WebSocket } from "ws"
import { isPlanSlug } from "../subscription/planCatalog"
import { hostSockets, type SocketLifecycle } from "./hostedSockets"
import {
    gatewayCredential,
    gatewayCredentialHeader,
    isInternalRequest,
    matchesCredential,
    type ServiceName
} from "./internalHttp"
import { maxRelayPayload, ServiceRelay } from "./relay"
import { createFeatureIo } from "./socketAdapter"
import {
    domainReplicaHeader,
    gatewaySlotHeader,
    multiGatewayRelayVersion,
    relayVersionHeader,
    type GatewaySlot
} from "./socketProtocol"

type GatewayLink = { peer: WebSocket; relay: ServiceRelay; multiGateway: boolean; managed: boolean }

export function createDomainSocket(server: HttpServer, service: ServiceName, lifecycle: SocketLifecycle) {
    const relayServer = new WebSocketServer({ noServer: true, maxPayload: maxRelayPayload })
    const gateway = gatewayCredential(service, "socket")
    const links = new Map<GatewaySlot, GatewayLink>()
    const cleanup = new Map<GatewaySlot, Promise<unknown>>()
    let stopping = false
    let replicaReady = false
    const replicated = service !== "AUTH" && process.env.PLAYTIME_DOMAIN_ROLLOUT === "1"
    const connections = (multiGatewayOnly = false) =>
        [...links.values()].flatMap(({ relay, multiGateway }) =>
            relay.connected && (!multiGatewayOnly || multiGateway) ? [relay] : []
        )
    const io = createFeatureIo(connections)
    const multiGatewayIo = createFeatureIo(() => connections(true))
    relayServer.on("headers", (headers, req) => {
        headers.push(`${relayVersionHeader}: ${multiGatewayRelayVersion}`)
        if (replicated && req.headers[domainReplicaHeader] === "1") headers.push(`${domainReplicaHeader}: 1`)
    })

    server.on("upgrade", (req, socket, head) => {
        const slot = req.headers[gatewaySlotHeader] ?? "primary"
        if (
            stopping ||
            req.url !== "/internal/gateway" ||
            (slot !== "primary" && slot !== "secondary") ||
            links.has(slot) ||
            !isInternalRequest(req) ||
            !matchesCredential(req.headers[gatewayCredentialHeader], gateway)
        ) {
            socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
            return
        }
        relayServer.handleUpgrade(req, socket, head, (peer) => {
            const hosted = hostSockets(
                io,
                lifecycle,
                connections,
                () => relay,
                () => cleanup.get(slot)
            )
            const relay: ServiceRelay = new ServiceRelay(peer, {
                ...hosted.handlers,
                "gateway:planChanged": (userId, planSlug) => {
                    if (service === "ROOM" || !Number.isSafeInteger(userId) || userId <= 0 || !isPlanSlug(planSlug))
                        return
                    io.to(String(userId)).emit("subscription:planChanged", { planSlug })
                }
            })
            const multiGateway = req.headers[relayVersionHeader] === multiGatewayRelayVersion
            const managed = replicated && req.headers[domainReplicaHeader] === "1"
            links.set(slot, { relay, peer, multiGateway, managed })
            if (links.get("primary")?.managed && links.get("secondary")?.managed) {
                replicaReady = true
                for (const link of links.values()) link.relay.notify("domain:ready")
            }
            peer.once("close", () => {
                links.delete(slot)
                if (managed) return hosted.discard()
                const done = hosted.close()
                cleanup.set(slot, done)
                void done.then(() => {
                    if (cleanup.get(slot) === done) cleanup.delete(slot)
                })
            })
        })
    })
    return {
        io,
        multiGatewayIo,
        ready: () => !stopping && (!replicated || replicaReady),
        hasGatewayLinks: () => !stopping && connections().length > 0,
        async close() {
            stopping = true
            await Promise.allSettled(
                [...links.values()].filter(({ managed }) => managed).map(({ relay }) => relay.request("domain:drain"))
            )
            await Promise.all(
                [...links.values()].map(
                    ({ peer }) =>
                        new Promise<void>((resolve) => {
                            peer.once("close", resolve)
                            peer.close(1001)
                        })
                )
            )
            await Promise.all(cleanup.values())
        }
    }
}
