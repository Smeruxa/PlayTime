import type { FeatureContext } from "../../../shared/socket/featureContext"
import { redis } from "../../../shared/redis"
import { isValidScreenFrame } from "../../media/screenFrame"
import { normalizeVoicePayload, normalizeVoiceSampleRate } from "../../media/voicePacket"
import { maybeDenoiseVoicePayload } from "../../media/voiceDenoise"
import { parseRoomIdField } from "../../../shared/socket/parseRoomId"
import { allowScreenFrame } from "../../media/screenBroadcastThrottle"
import type { PartyRoomServices } from "./roomsSocket"

const ROOM_SOCKET_PREFIX = "room:"

export interface PartyVoicePayload {
    roomId?: unknown
    voiceData?: unknown
    sampleRate?: number
}

export interface PartyScreenPayload {
    roomId?: unknown
    frame?: unknown
}

export default function registerPartyMedia(
    { socket, user }: FeatureContext,
    getRoomLimits: PartyRoomServices["limits"]
): void {
    const username = user.username

    socket.on("party:voice:broadcast", async (data: PartyVoicePayload) => {
        try {
            const roomId = parseRoomIdField(data?.roomId)
            const voiceData = normalizeVoicePayload(data?.voiceData)
            if (!roomId || !voiceData) return
            const roomName = ROOM_SOCKET_PREFIX + roomId
            if (!socket.rooms.has(roomName)) return
            const sr = normalizeVoiceSampleRate(data.sampleRate)
            const outVoice = await maybeDenoiseVoicePayload(voiceData, sr, `u${user.id}`)
            socket.to(roomName).emit("party:voice:receive", {
                voiceData: outVoice,
                sampleRate: sr,
                senderId: socket.id,
                senderUsername: username
            })
        } catch (err) {
            console.error("party:voice:broadcast", err)
        }
    })

    socket.on("party:screen:broadcast", async (data: PartyScreenPayload) => {
        try {
            const roomId = parseRoomIdField(data?.roomId)
            if (!roomId || !isValidScreenFrame(data.frame)) return
            const roomName = ROOM_SOCKET_PREFIX + roomId
            if (!socket.rooms.has(roomName)) return
            const limits = await getRoomLimits(roomId)
            if (!limits) return
            if (!(await allowScreenFrame(redis, user.id, limits.maxScreenBroadcastFps))) return
            socket.to(roomName).emit("party:screen:receive", {
                frame: data.frame,
                senderUsername: username
            })
        } catch (err) {
            console.error("party:screen:broadcast", err)
        }
    })

    socket.on("party:screen:audio:broadcast", async (data: PartyVoicePayload) => {
        try {
            const roomId = parseRoomIdField(data?.roomId)
            const voiceData = normalizeVoicePayload(data?.voiceData)
            if (!roomId || !voiceData) return
            const roomName = ROOM_SOCKET_PREFIX + roomId
            if (!socket.rooms.has(roomName)) return
            const sr = normalizeVoiceSampleRate(data.sampleRate)
            const outVoice = await maybeDenoiseVoicePayload(voiceData, sr, `u${user.id}`)
            socket.to(roomName).emit("party:screen:audio:receive", {
                voiceData: outVoice,
                sampleRate: sr,
                senderId: socket.id,
                senderUsername: username
            })
        } catch (err) {
            console.error("party:screen:audio:broadcast", err)
        }
    })

    socket.on("party:screen:stop", async (data: Pick<PartyScreenPayload, "roomId">) => {
        try {
            const roomId = parseRoomIdField(data?.roomId)
            if (!roomId) return
            const roomName = ROOM_SOCKET_PREFIX + roomId
            if (!socket.rooms.has(roomName)) return
            socket.to(roomName).emit("party:screen:stopped", { senderUsername: username })
        } catch (err) {
            console.error("party:screen:stop", err)
        }
    })
}
