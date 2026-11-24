export function float32ToInt16(buffer: Float32Array): Int16Array {
    const out = new Int16Array(buffer.length)
    for (let i = 0; i < buffer.length; i++) {
        const s = Math.max(-1, Math.min(1, buffer[i]))
        out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767)
    }
    return out
}

export function int16ToFloat32(buffer: Int16Array): Float32Array {
    const out = new Float32Array(buffer.length)
    for (let i = 0; i < buffer.length; i++) {
        out[i] = buffer[i] / (buffer[i] < 0 ? 32768 : 32767)
    }
    return out
}
