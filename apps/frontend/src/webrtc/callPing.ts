export type CallPingLevel = "good" | "ok" | "warn" | "bad" | "unknown"

export type CallPingSample = {
    rttMs: number | null
    peerCount: number
}

export function classifyPing(rttMs: number | null): CallPingLevel {
    if (rttMs == null || !Number.isFinite(rttMs)) return "unknown"
    if (rttMs < 80) return "good"
    if (rttMs < 150) return "ok"
    if (rttMs < 250) return "warn"
    return "bad"
}

function considerRttSeconds(bestMs: number | null, rawSec: unknown): number | null {
    if (typeof rawSec !== "number" || rawSec <= 0 || !Number.isFinite(rawSec)) return bestMs
    const ms = Math.round(rawSec * 1000)
    if (bestMs == null || ms > bestMs) return ms
    return bestMs
}

function rttFromCandidatePair(report: RTCStats): number | null {
    const pair = report as RTCStats & {
        currentRoundTripTime?: number
        responsesReceived?: number
        totalRoundTripTime?: number
    }
    let rttMs: number | null = null
    rttMs = considerRttSeconds(rttMs, pair.currentRoundTripTime)
    const responses = pair.responsesReceived
    const total = pair.totalRoundTripTime
    if (typeof responses === "number" && responses > 0 && typeof total === "number" && total > 0) {
        rttMs = considerRttSeconds(rttMs, total / responses)
    }
    return rttMs
}

function isActiveCandidatePair(report: RTCStats): boolean {
    if (report.type !== "candidate-pair") return false
    const pair = report as RTCStats & {
        nominated?: boolean
        selected?: boolean
        state?: string
    }
    if (pair.nominated === true) return true
    if (pair.selected === true) return true
    const state = pair.state
    return state === "succeeded" || state === "in-progress"
}

function collectRttFromReport(report: RTCStats, bestMs: number | null): number | null {
    if (report.type === "candidate-pair" && isActiveCandidatePair(report)) {
        const fromPair = rttFromCandidatePair(report)
        if (fromPair != null) return fromPair
    }
    const media = report as RTCStats & { kind?: string; roundTripTime?: number }
    if (report.type === "remote-inbound-rtp" && media.kind === "audio") {
        return considerRttSeconds(bestMs, media.roundTripTime)
    }
    if ((report.type as string) === "googCandidatePair") {
        const legacy = report as RTCStats & { googRtt?: number }
        if (typeof legacy.googRtt === "number") {
            return considerRttSeconds(bestMs, legacy.googRtt)
        }
    }
    return bestMs
}

function collectRttFromStatsReport(stats: RTCStatsReport): number | null {
    let rttMs: number | null = null

    stats.forEach((report) => {
        if (report.type === "transport") {
            const transport = report as RTCStats & { selectedCandidatePairId?: string }
            if (typeof transport.selectedCandidatePairId === "string") {
                const pair = stats.get(transport.selectedCandidatePairId)
                if (pair && pair.type === "candidate-pair") {
                    const fromPair = rttFromCandidatePair(pair)
                    if (fromPair != null) rttMs = fromPair
                }
            }
        }
    })

    stats.forEach((report) => {
        rttMs = collectRttFromReport(report, rttMs)
    })

    return rttMs
}

export async function readPeerConnectionRttMs(pc: RTCPeerConnection): Promise<number | null> {
    try {
        let rttMs = collectRttFromStatsReport(await pc.getStats())
        if (rttMs != null) return rttMs

        for (const receiver of pc.getReceivers()) {
            if (receiver.track?.kind !== "audio") continue
            try {
                rttMs = collectRttFromStatsReport(await receiver.getStats())
                if (rttMs != null) return rttMs
            } catch {
            }
        }
        return null
    } catch {
        return null
    }
}
