import { createServer } from "node:http"
import { createDomainSocket } from "../shared/runtime/domainSocket"
import { configuredServicePort } from "../shared/runtime/internalHttp"
import { configureServiceEnvironment, createPrivateApp, listenService, runService } from "../shared/runtime/service"

runService(async () => {
    configureServiceEnvironment("ROOM", "room-api")
    const {
        configureRoomApi,
        registerRoomSocketFeatures,
        connectRoomSocket,
        disconnectRoomSocket
    }: typeof import("./app") = require("./app")
    const app = createPrivateApp("room-api")
    const server = createServer(app)
    const { io, close, ready, hasGatewayLinks } = createDomainSocket(server, "ROOM", {
        register: registerRoomSocketFeatures,
        connect: connectRoomSocket,
        disconnect: disconnectRoomSocket
    })
    app.get("/internal/ready", (_req, res) => res.sendStatus(ready() ? 200 : 503))
    server.once("close", await configureRoomApi(app, io, hasGatewayLinks))
    await listenService(
        server,
        "room-api",
        configuredServicePort("ROOM"),
        process.env.LISTEN_HOST || "127.0.0.1",
        close,
        18_000
    )
})
