import { createServer } from "node:http"
import { Server } from "socket.io"
import { createApp } from "./http/createApp"
import { getCorsOrigin } from "./http/settings"
import { createSocketAuth } from "./middlewares/authMiddleware"
import { ensureSiteBuild } from "./http/ensureSiteBuild"
import { setPresenceSource } from "./presence"
import { requestChat } from "../shared/runtime/chatContracts"
import { createGatewaySockets } from "./sockets"
import { configuredServiceUrl, proxyService } from "../shared/runtime/internalHttp"
import {
    createAuthSessionClient,
    requestAccountBlock,
    requestBearerAccess,
    requestRecoveryMailStatus
} from "../shared/runtime/authContracts"
import { startGatewayJobs } from "./backgroundJobs"
import { requestRingingRecipient } from "../shared/runtime/roomContracts"
import { configuredGatewaySlot, labelEngineSessions } from "./gatewaySlot"
import { monitorHttpDependencies } from "./http/serviceReadiness"

export function createGateway() {
    const auth = configuredServiceUrl("AUTH")
    const chat = configuredServiceUrl("CHAT")
    const slot = configuredGatewaySlot()
    const httpDependencies = slot ? monitorHttpDependencies(auth, chat) : undefined
    ensureSiteBuild()
    const app = createApp({
        gatewaySlot: slot,
        domainRoutes: proxyService({ auth, chat }),
        moderateAccount: requestAccountBlock,
        verifyBearerAccess: requestBearerAccess,
        getRecoveryMailStatus: requestRecoveryMailStatus,
        reports: {
            list: async (beforeId) => (await requestChat("reports/list", { beforeId })).reports,
            resolve: async (reportId) => {
                await requestChat("reports/resolve", { reportId })
            }
        }
    })
    let stopping = false
    const server = createServer(app)
    const io = new Server(server, {
        cors: { origin: getCorsOrigin(), credentials: true },
        path: "/playtime/socket.io",
        maxHttpBufferSize: 5 * 1024 * 1024,
        allowRequest(_req, done) {
            const ready = httpReady()
            done(ready ? null : "Gateway is not ready", ready)
        }
    })
    if (slot) labelEngineSessions(io, slot)
    app.set("io", io)
    setPresenceSource({
        friends: async (userId) => {
            const { friends } = await requestChat("presence-friends", { userId })
            return friends
        },
        audience: async (recipientId, participantIds) => {
            const { room } = await requestChat("audience", { recipientId, participantIds })
            return room
        }
    })
    const authSessions = createAuthSessionClient()
    const sockets = createGatewaySockets(io, slot, authSessions.check)
    const socketReady = () => !stopping && sockets.authAvailable() && (!slot || sockets.chatAvailable())
    const httpReady = () => socketReady() && (httpDependencies?.available() ?? true)
    app.set("publishSubscriptionPlan", sockets.publishPlan)
    app.get("/http-readyz", (_req, res) => {
        if (slot) res.set("X-PlayTime-Gateway-Slot", slot)
        res.status(httpReady() ? 200 : 503).end()
    })
    app.get("/readyz", (_req, res) => {
        if (slot)
            res.set({
                "X-PlayTime-Gateway-Slot": slot,
                "X-PlayTime-Domain-Replicas": sockets.domainReplicaCount().join(",")
            })
        res.status(httpReady() && (!slot || sockets.allRelaysAvailable()) ? 200 : 503).end()
    })
    io.use((socket, next) => {
        if (httpReady()) next()
        else socket.conn.close()
    })
    io.use(
        createSocketAuth({
            ...authSessions,
            verify: (token) => sockets.verifySession(() => authSessions.verify(token)),
            reconnectOnUnavailable: slot !== undefined,
            refreshEndpoint: sockets.refreshEndpoint
        })
    )
    server.once("close", startGatewayJobs(sockets.publishPlan, requestRingingRecipient, slot !== "secondary"))
    return {
        server,
        close: async () => {
            stopping = true
            httpDependencies?.stop()
            try {
                await sockets.waitForCommands()
                await io.close()
            } finally {
                await sockets.stop()
            }
        }
    }
}
