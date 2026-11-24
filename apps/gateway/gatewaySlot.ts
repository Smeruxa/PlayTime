import { randomBytes } from "node:crypto"
import type { Server } from "socket.io"
import type { GatewaySlot } from "../shared/runtime/socketProtocol"

export function configuredGatewaySlot(): GatewaySlot | undefined {
    const slot = process.env.PLAYTIME_GATEWAY_SLOT
    if (slot === undefined || slot === "") return undefined
    if (slot === "primary" || slot === "secondary") return slot
    throw new Error("PLAYTIME_GATEWAY_SLOT must be primary or secondary")
}

export function labelEngineSessions(io: Server, slot: GatewaySlot): void {
    const prefix = slot === "primary" ? "p_" : "s_"
    io.engine.generateId = () => prefix + randomBytes(18).toString("base64url")
}
