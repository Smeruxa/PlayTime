import { getDenoisePool } from "./denoisePool"
import { normalizeVoiceSampleRate } from "./voicePacket"

export function voicePayloadToBuffer(voiceData: unknown): Buffer | null {
    if (voiceData == null) return null
    if (Buffer.isBuffer(voiceData)) return voiceData
    if (voiceData instanceof ArrayBuffer) return Buffer.from(voiceData)
    if (ArrayBuffer.isView(voiceData)) {
        const v = voiceData as ArrayBufferView
        return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
    }
    return null
}

export async function maybeDenoiseVoicePayload(
    voiceData: unknown,
    sampleRate?: number,
    streamKey?: string
): Promise<unknown> {
    const pool = getDenoisePool()
    if (!pool) return voiceData
    const sr = normalizeVoiceSampleRate(sampleRate)
    if (sr !== 48000) return voiceData
    const buf = voicePayloadToBuffer(voiceData)
    if (!buf || buf.length < 2) return voiceData
    const key = streamKey && streamKey.length > 0 ? streamKey : "_"
    try {
        const out = await pool.process(buf, key)
        return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
    } catch {
        return voiceData
    }
}
