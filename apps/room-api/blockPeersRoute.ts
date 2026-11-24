import { json, type Express } from "express"
import { parseRoomBlockPeersCommand, roomBlockPeersPath } from "../shared/runtime/roomContracts"
import type { FeatureIo } from "../shared/socket/featureContext"
import { areCallPeersBlocked } from "./chatPolicy"
import { endBlockedPeerCall } from "./socket/directCall/endBlockedPeerCall"

export function mountBlockPeersRoute(app: Express, io: FeatureIo): void {
    app.post(roomBlockPeersPath, json({ limit: "2kb" }), async (req, res) => {
        const command = parseRoomBlockPeersCommand(req.body)
        if (!command) return res.status(400).json({ error: "Invalid peers" })
        await endBlockedPeerCall(command, areCallPeersBlocked, io)
        res.json({})
    })
}
