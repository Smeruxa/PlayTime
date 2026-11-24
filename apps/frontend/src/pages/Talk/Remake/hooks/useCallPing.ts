import { useEffect, useState, type RefObject } from "react"
import type { Socket } from "socket.io-client"
import type { VoiceMesh } from "../../../../webrtc"
import type { CallPingSample } from "../../../../webrtc/callPing"

const POLL_MS = 1500

async function measureSocketRttMs(socket: Socket): Promise<number | null> {
    if (!socket.connected) return null
    return new Promise((resolve) => {
        const sentAt = Date.now()
        let settled = false
        const finish = (value: number | null) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(value)
        }
        const timer = setTimeout(() => finish(null), 1200)
        socket.emit("ping:measure", sentAt, (payload: unknown) => {
            if (payload !== sentAt) {
                finish(null)
                return
            }
            finish(Math.max(0, Date.now() - sentAt))
        })
    })
}

export function useCallPing(
    meshRef: RefObject<VoiceMesh | null>,
    socket: Socket | null,
    enabled: boolean
): CallPingSample {
    const [sample, setSample] = useState<CallPingSample>({ rttMs: null, peerCount: 0 })

    useEffect(() => {
        if (!enabled) {
            setSample({ rttMs: null, peerCount: 0 })
            return undefined
        }

        let cancelled = false

        const poll = async () => {
            const mesh = meshRef.current
            if (!mesh) {
                if (!cancelled) setSample({ rttMs: null, peerCount: 0 })
                return
            }
            const next = await mesh.getPingSample()
            if (cancelled) return
            if (next.rttMs != null || next.peerCount === 0) {
                setSample(next)
                return
            }
            if (socket?.connected) {
                const socketRtt = await measureSocketRttMs(socket)
                if (!cancelled) {
                    setSample({
                        rttMs: socketRtt,
                        peerCount: next.peerCount
                    })
                }
                return
            }
            setSample(next)
        }

        void poll()
        const timer = setInterval(() => void poll(), POLL_MS)
        return () => {
            cancelled = true
            clearInterval(timer)
        }
    }, [meshRef, socket, enabled])

    return sample
}
