export type PeerDiagnostics = {
    connection: RTCPeerConnectionState
    ice: RTCIceConnectionState
    transport: string
    relay: boolean | null
    rttMs: number | null
    lostPercent: number | null
    jitterMs: number | null
}
export type CallDiagnostics = {
    capturedAt: string
    microphone: { available: boolean; enabled: boolean; device: string | null }
    reconnectAttempts: number
    peers: PeerDiagnostics[]
}
export async function peerDiagnostics(pc: RTCPeerConnection): Promise<PeerDiagnostics> {
    const result: PeerDiagnostics = { connection: pc.connectionState, ice: pc.iceConnectionState, transport: "—", relay: null, rttMs: null, lostPercent: null, jitterMs: null }
    try {
        const stats = await pc.getStats()
        let lost = 0, received = 0
        stats.forEach((entry: any) => {
            if (entry.type === "transport" && entry.selectedCandidatePairId) {
                const pair = stats.get(entry.selectedCandidatePairId)
                if (pair) {
                    const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId)
                    result.transport = local?.protocol || remote?.protocol || "—"
                    result.relay = local?.candidateType === "relay" || remote?.candidateType === "relay"
                    if (Number.isFinite(pair.currentRoundTripTime)) result.rttMs = Math.round(pair.currentRoundTripTime * 1000)
                }
            }
            if (entry.type === "inbound-rtp" && entry.kind === "audio") {
                lost += Math.max(0, entry.packetsLost || 0); received += entry.packetsReceived || 0
                if (Number.isFinite(entry.jitter)) result.jitterMs = Math.max(result.jitterMs || 0, Math.round(entry.jitter * 1000))
            }
        })
        if (lost + received > 0) result.lostPercent = Math.round(lost / (lost + received) * 1000) / 10
    } catch {  }
    return result
}
