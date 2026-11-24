import type { FeatureContext } from "../../../shared/socket/featureContext"
import type {
    CallRoomBroadcastPayload,
    CallRoomIdPayload,
    CallRoomScreenPayload
} from "../../../shared/types/contracts/directCall"
import { redis } from "../../../shared/redis"
import { allowScreenFrame } from "../../media/screenBroadcastThrottle"
import { isValidScreenFrame } from "../../media/screenFrame"
import { maybeDenoiseVoicePayload } from "../../media/voiceDenoise"
import { normalizeVoicePayload, normalizeVoiceSampleRate } from "../../media/voicePacket"
import { isCallParticipant } from "./instance"
import { authorizeMedia } from "./ownership"
import { getRoom } from "./redisService"
import type { DirectCallServices } from "./services"

const audioEvents = {
    voice: { outgoing: "call:room:broadcast", incoming: "call:room:receive" },
    screen: { outgoing: "call:room:screen:audio:broadcast", incoming: "call:room:screen:audio:receive" }
}

export function registerCallMedia(
    { io, socket, user }: FeatureContext,
    { screenFps }: Pick<DirectCallServices, "screenFps">
): void {
    const uid = user.id

    for (const channel of ["voice", "screen"] as const) {
        const { outgoing, incoming } = audioEvents[channel]
        socket.on(outgoing, async (data: CallRoomBroadcastPayload) => {
            try {
                const roomId = data?.roomId
                const voiceData = normalizeVoicePayload(data?.voiceData)
                if (!voiceData) {
                    if (channel === "voice") socket.emit("call:room:error", { err: "Invalid audio" })
                    return
                }
                if (!(await getRoom(roomId ?? ""))) return socket.emit("call:room:error", { err: "Room not found" })
                const delivery = await authorizeMedia(socket, uid, roomId ?? "", data)
                if (!delivery) return

                const sampleRate = normalizeVoiceSampleRate(data.sampleRate)
                const output = await maybeDenoiseVoicePayload(voiceData, sampleRate, `u${uid}`)
                io.to(delivery.target).emit(incoming, {
                    ...delivery.epochs,
                    roomId,
                    voiceData: output,
                    sampleRate,
                    senderId: socket.id,
                    ...(channel === "screen" ? { senderUsername: user.username } : {})
                })
            } catch (error) {
                console.log(`${outgoing} error`, error)
                socket.emit("call:room:error", { err: "Server error" })
            }
        })
    }

    socket.on("call:room:screen:broadcast", async (data: CallRoomScreenPayload) => {
        try {
            const { roomId, frame } = data
            if (!isValidScreenFrame(frame)) return
            const room = await getRoom(roomId ?? "")
            if (!room) return socket.emit("call:room:error", { err: "Room not found" })

            const maxScreenFps = await screenFps(uid)
            if (!(await allowScreenFrame(redis, uid, maxScreenFps))) return

            const delivery = await authorizeMedia(socket, uid, roomId ?? "", data)
            if (!delivery) return

            io.to(delivery.target).emit("call:room:screen:receive", {
                ...delivery.epochs,
                roomId,
                frame,
                senderUsername: user.username
            })
        } catch (err) {
            console.log("call:room:screen:broadcast error", err)
            socket.emit("call:room:error", { err: "Server error" })
        }
    })

    socket.on("call:room:screen:stop", async (data: CallRoomIdPayload) => {
        try {
            const { roomId } = data
            const room = await getRoom(roomId ?? "")
            if (!room) return
            if (!isCallParticipant(room, uid)) return
            const delivery = await authorizeMedia(socket, uid, roomId ?? "", data)
            if (!delivery) return
            io.to(delivery.target).emit("call:room:screen:stopped", {
                roomId,
                ...delivery.epochs,
                senderUsername: user.username
            })
        } catch (err) {
            console.log("call:room:screen:stop error", err)
        }
    })
}
