import { getStoredInputDeviceId } from "../audioDeviceStorage"

export const MIC_CAPTURE_AUDIO: MediaTrackConstraints = {
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: false
}

export async function getMicStream(): Promise<MediaStream> {
    const inputId = getStoredInputDeviceId()
    try {
        return await navigator.mediaDevices.getUserMedia({
            audio: inputId ? { ...MIC_CAPTURE_AUDIO, deviceId: { ideal: inputId } } : MIC_CAPTURE_AUDIO
        })
    } catch (error) {
        if (inputId && error instanceof Error && ["NotFoundError", "OverconstrainedError"].includes(error.name)) {
            return await navigator.mediaDevices.getUserMedia({ audio: MIC_CAPTURE_AUDIO })
        }
        throw error
    }
}

export function setMicEnabled(stream: MediaStream, enabled: boolean): void {
    stream.getAudioTracks().forEach((t) => {
        t.enabled = enabled
    })
}
