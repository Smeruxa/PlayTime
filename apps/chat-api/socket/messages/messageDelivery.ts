import type { FeatureRooms } from "../../../shared/socket/featureContext"

export async function emitStoredMessage(target: FeatureRooms, message: unknown): Promise<void> {
    try {
        if (target.emitConfirmed) await target.emitConfirmed("message:receive", message)
        else target.emit("message:receive", message)
    } catch (error) {
        console.error("stored message realtime delivery", error)
    }
}
