import { json, type Express } from "express"
import { parseRingingRecipient, ringingRecipientPath } from "../shared/runtime/roomContracts"
import { getRoom } from "./socket/directCall/redisService"

export async function isRingingRecipient(roomId: string, recipientId: number): Promise<boolean> {
    const call = await getRoom(roomId)
    return call?.status === "request_receiver" && call.receiver_id === recipientId
}

export function mountRingingRecipientRoute(app: Express): void {
    app.post(ringingRecipientPath, json({ limit: "2kb" }), async (req, res) => {
        const input = parseRingingRecipient(req.body)
        if (!input) return res.sendStatus(400)
        res.json({ ringing: await isRingingRecipient(input.roomId, input.recipientId) })
    })
}
