import { configureServiceEnvironment, listenService, runService } from "../shared/runtime/service"
import { warnMissingTrustedProxyIps } from "../shared/http/clientIp"
import { configuredGatewaySlot } from "./gatewaySlot"

async function main(): Promise<void> {
    configureServiceEnvironment("GATEWAY", "gateway")
    warnMissingTrustedProxyIps()
    const { createGateway }: typeof import("./app") = require("./app")
    const { server, close } = createGateway()
    await listenService(
        server,
        "gateway",
        Number(process.env.PORT || 1501),
        process.env.LISTEN_HOST || "127.0.0.1",
        close,
        configuredGatewaySlot() ? 40_000 : 10_000
    )
}

runService(main)
