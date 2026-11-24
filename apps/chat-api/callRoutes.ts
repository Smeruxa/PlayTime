import { Router } from "express"
import { parseCallHistoryEntry, parseIncomingCallPush, type ChatResponse } from "../shared/runtime/chatContracts"
import { enqueuePush } from "../database/pushOutbox"
import { logDirectCallDuration } from "./services/callHistory"
import type { FeatureIo } from "../shared/socket/featureContext"

export function makeCallRoutes(io: FeatureIo) {
    const router = Router()

    router.post("/call-log", async (req, res) => {
        const entry = parseCallHistoryEntry(req.body)
        if (!entry) return res.sendStatus(400)
        const { roomId, beginerId, receiverId, confirmedAt, endedAt, instanceId } = entry
        await logDirectCallDuration(
            io,
            {
                beginer_id: beginerId,
                receiver_id: receiverId,
                confirmed_at: confirmedAt,
                instance_id: instanceId
            },
            endedAt,
            roomId
        )
        return res.json({} satisfies ChatResponse<"call-log">)
    })

    router.post("/call-push", async (req, res) => {
        const input = parseIncomingCallPush(req.body)
        if (!input) return res.sendStatus(400)
        const { roomId, senderId, senderUsername, recipientId, expiresAt } = input
        await enqueuePush({
            eventKey: `c:${roomId}`,
            chatKey: `dm:${senderUsername}`,
            senderId,
            recipients: [recipientId],
            callRoomId: roomId,
            target: { version: 1, userId: recipientId, kind: "call" },
            title: senderUsername,
            expiresAt
        })
        return res.json({} satisfies ChatResponse<"call-push">)
    })

    return router
}
