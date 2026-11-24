import { createServer } from "node:http"
import { createDomainSocket } from "../shared/runtime/domainSocket"
import { configuredServicePort } from "../shared/runtime/internalHttp"
import { configureServiceEnvironment, createPrivateApp, listenService, runService } from "../shared/runtime/service"

runService(async () => {
    configureServiceEnvironment("AUTH", "auth-api")
    const { configureAuthApi, registerAuthSocketFeatures }: typeof import("./app") = require("./app")
    const app = createPrivateApp("auth-api")
    const server = createServer(app)
    const { io, close } = createDomainSocket(server, "AUTH", { register: registerAuthSocketFeatures })
    server.once("close", await configureAuthApi(app, io))
    await listenService(
        server,
        "auth-api",
        configuredServicePort("AUTH"),
        process.env.LISTEN_HOST || "127.0.0.1",
        close
    )
})
