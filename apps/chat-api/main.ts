import { createServer } from "node:http"
import { json } from "express"
import { createDomainSocket } from "../shared/runtime/domainSocket"
import { configuredServicePort } from "../shared/runtime/internalHttp"
import { configureServiceEnvironment, createPrivateApp, listenService, runService } from "../shared/runtime/service"

runService(async () => {
    configureServiceEnvironment("CHAT", "chat-api")
    const { chatPresence, configureChatApi, registerChatSocketFeatures }: typeof import("./app") = require("./app")

    const app = createPrivateApp("chat-api")
    app.use(json({ limit: "32kb" }))
    const server = createServer(app)
    const { io, multiGatewayIo, close, ready } = createDomainSocket(server, "CHAT", {
        register: registerChatSocketFeatures,
        async connect({ socket }, renewal) {
            if (!renewal) chatPresence.onConnect(socket, multiGatewayIo)
        },
        async disconnect({ socket }) {
            chatPresence.onDisconnect(socket, multiGatewayIo)
        }
    })
    app.get("/internal/ready", (_req, res) => res.sendStatus(ready() ? 200 : 503))
    server.once("close", await configureChatApi(app, io))

    await listenService(
        server,
        "chat-api",
        configuredServicePort("CHAT"),
        process.env.LISTEN_HOST || "127.0.0.1",
        close,
        18_000
    )
})
