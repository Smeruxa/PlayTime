import "dotenv/config"
import { callStore } from "../room-api/socket/directCall/redisService"
import { registerCallEndpoint } from "../room-api/socket/directCall/ownership"
import { isRingingRecipient } from "../room-api/ringingRecipientRoute"
import http from "http"
import { initializeDirectCalls } from "../room-api/socket/directCall/redisService"
import { Server } from "socket.io"
import { authSocket } from "./legacy/socketAuth"
import { onConnect as presenceOnConnect, onDisconnect as presenceOnDisconnect, setPresenceSource } from "./presence"
import { listPresenceFriends } from "../chat-api/peerRoutes"
import { peerEventRoom } from "../chat-api/socket/peerIdentity"
import { createLegacyApp } from "./legacy/http"
import { getCorsOrigin } from "./http/settings"
import { startGatewayJobs } from "./backgroundJobs"
import { startSessionMaintenance } from "../auth-api/services/sessionMaintenance"
import { startChatMaintenance } from "../chat-api/maintenance"
import { attachSocketConnection } from "./legacy/socket"
import { resolveAuthedUser } from "../shared/socket/featureContext"
import { socketAck } from "../shared/types/socket/ack"
import type { GetUsernameAckPayload } from "../shared/types/socket/usernamePayload"
import { runPendingMigrations } from "../database/runMigrations"
import { ensureSiteBuild } from "./http/ensureSiteBuild"
import { getSitePublicPath } from "./http/serveSite"
import { accessSessionRoom, deviceSessionRoom } from "../shared/types/contracts/accessSession"

async function main(): Promise<void> {
    if (!process.env.SKIP_DB_MIGRATIONS?.trim()) {
        await runPendingMigrations()
    }

    ensureSiteBuild()
    const stopChatMaintenance = await startChatMaintenance()
    await initializeDirectCalls()
    setPresenceSource({ friends: listPresenceFriends, audience: peerEventRoom })
    const app = createLegacyApp()
    const server = http.createServer(app)
    server.once("close", stopChatMaintenance)
    const CORS_ORIGIN = getCorsOrigin()

    const io = new Server(server, {
        cors: { origin: CORS_ORIGIN, credentials: true },
        path: "/playtime/socket.io",
        maxHttpBufferSize: 5 * 1024 * 1024
    })

    app.set("io", io)
    server.once("close", await startSessionMaintenance(io))
    server.once(
        "close",
        startGatewayJobs((userId, planSlug) => {
            io.to(String(userId)).emit("subscription:planChanged", { planSlug })
        }, isRingingRecipient)
    )

    io.use(authSocket)

    io.on("connection", (socket) => {
        const user = resolveAuthedUser(socket)
        if (!user) return
        presenceOnConnect(socket)
        socket.join(user.id.toString())
        if (socket.handshake.auth.peerIdentityProtocol === 1) socket.join(`peer-identity-v1:${user.id}`)
        socket.join(accessSessionRoom(socket.data.accessSession.jti))
        if (socket.data.accessSession.sessionId) socket.join(deviceSessionRoom(socket.data.accessSession.sessionId))
        if (process.env.LOG_CONNECTIONS === "1" || process.env.NODE_ENV !== "production") {
            console.log("Client connected", user.id)
        }

        void registerCallEndpoint(socket, user.id).catch((error) => {
            console.error("call:endpoint registration", error)
            socket.disconnect(true)
        })
        attachSocketConnection(io, socket, user)

        socket.on("get:username", (callback: unknown) => {
            const ack = socketAck<GetUsernameAckPayload>(callback)
            if (!ack) return
            ack({
                username: user.username,
                userId: user.id
            })
        })

        socket.on("disconnect", () => {
            void Promise.resolve(socket.data.callEndpointReady)
                .then(() => callStore.disconnectEndpoint(socket.id))
                .catch((error) => console.error("call:endpoint disconnect", error))
            presenceOnDisconnect(socket)
            if (process.env.LOG_CONNECTIONS === "1" || process.env.NODE_ENV !== "production") {
                console.log("Client disconnected", user.id)
            }
        })
    })

    const PORT = Number(process.env.PORT) || 1501
    const HOST = process.env.LISTEN_HOST?.trim() || (process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0")
    server.listen(PORT, HOST, () => {
        const sitePath = getSitePublicPath()
        console.log("Server running on", HOST + ":" + PORT)
        console.log("Marketing site path:", `${sitePath}/`)
        console.log("API prefix: /playtime/auth, /playtime/subscription, …")
    })
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
