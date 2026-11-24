const KEY_IN = "playtime_audio_input_id"
const KEY_OUT = "playtime_audio_output_id"

export function getStoredInputDeviceId(): string | undefined {
    const v = localStorage.getItem(KEY_IN)
    return v && v.length > 0 ? v : undefined
}

export function getStoredOutputDeviceId(): string | undefined {
    const v = localStorage.getItem(KEY_OUT)
    return v && v.length > 0 ? v : undefined
}

export function setStoredInputDeviceId(id: string) {
    if (!id) localStorage.removeItem(KEY_IN)
    else localStorage.setItem(KEY_IN, id)
}

export function setStoredOutputDeviceId(id: string) {
    if (!id) localStorage.removeItem(KEY_OUT)
    else localStorage.setItem(KEY_OUT, id)
}
