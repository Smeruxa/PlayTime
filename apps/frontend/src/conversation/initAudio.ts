import { getStoredInputDeviceId, getStoredOutputDeviceId } from "../audioDeviceStorage"
import { MIC_CAPTURE_AUDIO } from "../webrtc/micStream"
import { float32ToInt16 } from "./pcmConvert"
import { publicAssetUrl } from "../utils/publicAssetUrl"

export type InitAudioOptions = {
    isParty?: boolean
}

async function applyPlaybackSink(audioContext: AudioContext): Promise<void> {
    const outId = getStoredOutputDeviceId()
    const ctx = audioContext as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    if (outId && typeof ctx.setSinkId === "function") {
        try {
            await ctx.setSinkId(outId)
        } catch {
        }
    }
}

export async function initAudio(socket: any, roomId: string | number, options?: InitAudioOptions) {
    const audioContext = new AudioContext({ sampleRate: 48000 })
    await applyPlaybackSink(audioContext)
    if (audioContext.sampleRate !== 48000) {
        console.warn(`[voice] AudioContext ${audioContext.sampleRate} Hz — RNNoise на сервере рассчитан на 48000`)
    }
    const workletPath =
        window.location.protocol === "file:"
            ? await (window as any).electronAPI.getWorkletPath()
            : publicAssetUrl("recorder-worklet.js")
    await audioContext.audioWorklet.addModule(workletPath)

    const inputId = getStoredInputDeviceId()
    let stream: MediaStream
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: inputId ? { ...MIC_CAPTURE_AUDIO, deviceId: { ideal: inputId } } : MIC_CAPTURE_AUDIO
        })
    } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CAPTURE_AUDIO })
    }
    const source = audioContext.createMediaStreamSource(stream)

    const micGain = audioContext.createGain()
    const micStorage = localStorage.getItem("micState")
    micGain.gain.value = micStorage !== null ? (JSON.parse(micStorage) ? 1 : 0) : 1

    const recorderNode = new AudioWorkletNode(audioContext, "recorder-processor")
    const broadcastEvent = options?.isParty ? "party:voice:broadcast" : "call:room:broadcast"

    recorderNode.port.onmessage = (event) => {
        const int16 = float32ToInt16(event.data)
        socket.emit(broadcastEvent, {
            roomId,
            voiceData: int16.buffer,
            sampleRate: audioContext.sampleRate
        })
    }

    source.connect(micGain).connect(recorderNode)

    const silentOut = audioContext.createGain()
    silentOut.gain.value = 0
    recorderNode.connect(silentOut)
    silentOut.connect(audioContext.destination)

    return {
        audioContext,
        mediaStream: stream,
        setMicState: (state: boolean) => {
            const target = state ? 1 : 0
            micGain.gain.cancelScheduledValues(audioContext.currentTime)
            micGain.gain.linearRampToValueAtTime(target, audioContext.currentTime + 0.05)
            localStorage.setItem("micState", JSON.stringify(state))
        }
    }
}
