import { int16ToFloat32 } from "./pcmConvert"
import { getParticipantVolume } from "./participantVolume"

type PlaybackState = {
    nextTime: number
}

const playbackByContext = new WeakMap<AudioContext, Map<string, PlaybackState>>()

const EDGE_FADE_SEC = 0.004

function applyEdgeFade(samples: Float32Array, sampleRate: number): void {
    const n = Math.min(Math.floor(sampleRate * EDGE_FADE_SEC), Math.floor(samples.length / 2))
    if (n <= 1) return
    for (let i = 0; i < n; i++) {
        const g = i / (n - 1)
        samples[i] *= g
        samples[samples.length - 1 - i] *= g
    }
}

function getPlaybackState(audioContext: AudioContext, senderId: string): PlaybackState {
    let bySender = playbackByContext.get(audioContext)
    if (!bySender) {
        bySender = new Map()
        playbackByContext.set(audioContext, bySender)
    }
    let state = bySender.get(senderId)
    if (!state) {
        state = { nextTime: 0 }
        bySender.set(senderId, state)
    }
    return state
}

export function playAudio(
    audioContext: AudioContext,
    data: ArrayBuffer,
    sampleRate?: number,
    senderId?: string,
    senderUsername?: string
): void {
    if (!audioContext) return

    const floatData = int16ToFloat32(new Int16Array(data))
    if (floatData.length === 0) return

    const rate = sampleRate ?? audioContext.sampleRate
    applyEdgeFade(floatData, rate)

    const buffer = audioContext.createBuffer(1, floatData.length, rate)
    buffer.getChannelData(0).set(floatData)

    const chunkDuration = floatData.length / rate
    const key = senderId ?? "default"
    const state = getPlaybackState(audioContext, key)
    const now = audioContext.currentTime

    const PLAYOUT_LAG = 0.06
    const RESYNC_AHEAD = 2.5
    const RESYNC_BEHIND = 0.2

    if (state.nextTime === 0 || state.nextTime - now > RESYNC_AHEAD) {
        state.nextTime = now + PLAYOUT_LAG
    } else if (now - state.nextTime > RESYNC_BEHIND) {
        state.nextTime = now + PLAYOUT_LAG * 0.5
    }

    const startTime = Math.max(state.nextTime, now)
    state.nextTime = startTime + chunkDuration

    let gainValue = Number(localStorage.getItem("valueSound") || 100) / 100
    if (senderUsername) gainValue *= getParticipantVolume(senderUsername)
    const gainNode = audioContext.createGain()
    gainNode.gain.value = gainValue

    const src = audioContext.createBufferSource()
    src.buffer = buffer
    src.connect(gainNode)
    gainNode.connect(audioContext.destination)
    src.start(startTime)
}
