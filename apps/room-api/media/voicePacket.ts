export const MAX_VOICE_PACKET_BYTES = 128 * 1024

const SAMPLE_RATE_MIN = 8_000
const SAMPLE_RATE_MAX = 192_000

export function normalizeVoiceSampleRate(sampleRate: unknown): number | undefined {
    if (typeof sampleRate !== "number" || !Number.isFinite(sampleRate)) return undefined
    const r = Math.round(sampleRate)
    if (r < SAMPLE_RATE_MIN || r > SAMPLE_RATE_MAX) return undefined
    return r
}

export function voicePayloadByteLength(voiceData: unknown): number {
    if (ArrayBuffer.isView(voiceData) || voiceData instanceof ArrayBuffer) return voiceData.byteLength
    return 0
}

export function isValidVoicePayload(voiceData: unknown): boolean {
    const bytes = voicePayloadByteLength(voiceData)
    return bytes > 0 && bytes <= MAX_VOICE_PACKET_BYTES
}

export function normalizeVoicePayload(voiceData: unknown): Buffer | null {
    if (!isValidVoicePayload(voiceData)) return null
    if (ArrayBuffer.isView(voiceData)) {
        return Buffer.from(new Uint8Array(voiceData.buffer, voiceData.byteOffset, voiceData.byteLength))
    }
    return Buffer.from(new Uint8Array(voiceData as ArrayBuffer))
}
