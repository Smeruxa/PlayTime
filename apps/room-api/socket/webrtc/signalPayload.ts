import type { WebrtcSignalType } from "../../../shared/types/contracts/webrtc"

export function readSignalPayload(type: WebrtcSignalType, value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const data = value as Record<string, unknown>
    if (type !== "ice") {
        if (typeof data.sdp !== "string" || Buffer.byteLength(data.sdp) > 128 * 1024) return null
        if (data.type !== undefined && data.type !== type) return null
        return { type, sdp: data.sdp }
    }
    const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = data
    if (typeof candidate !== "string" || candidate.length > 4096) return null
    if (sdpMid != null && (typeof sdpMid !== "string" || sdpMid.length > 256)) return null
    if (usernameFragment != null && (typeof usernameFragment !== "string" || usernameFragment.length > 256)) return null
    if (sdpMLineIndex != null && (typeof sdpMLineIndex !== "number" || !Number.isInteger(sdpMLineIndex) || sdpMLineIndex < 0 || sdpMLineIndex > 65535)) return null
    return { candidate, sdpMid, sdpMLineIndex, usernameFragment }
}
