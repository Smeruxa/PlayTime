import { getStoredOutputDeviceId } from "../audioDeviceStorage"
import { getParticipantVolume } from "../conversation/participantVolume"

type PeerPlayback = {
    username: string
    audio: HTMLAudioElement
    stream: MediaStream
    pc?: RTCPeerConnection
    lastResyncAt: number
}

const PLAYOUT_DELAY_HINT_SEC = 0.05
const JITTER_RESYNC_THRESHOLD_SEC = 0.45
const JITTER_CHECK_INTERVAL_MS = 3000
const RESYNC_COOLDOWN_MS = 8000

export class RemoteAudioPlayback {
    private readonly peers = new Map<number, PeerPlayback>()
    private volumeTimer: ReturnType<typeof setInterval> | null = null
    private jitterTimer: ReturnType<typeof setInterval> | null = null
    private readonly resumePlayback = () => {
        for (const { audio } of Array.from(this.peers.values())) {
            if (audio.paused) void audio.play().catch(() => {})
        }
    }

    constructor() {
        this.volumeTimer = setInterval(() => this.refreshGains(), 400)
        this.jitterTimer = setInterval(() => void this.checkJitterBuffers(), JITTER_CHECK_INTERVAL_MS)
        document.addEventListener("pointerdown", this.resumePlayback)
        document.addEventListener("keydown", this.resumePlayback)
    }

    attachPeer(
        userId: number,
        username: string,
        stream: MediaStream,
        pc?: RTCPeerConnection
    ): void {
        this.detachPeer(userId)
        const audio = document.createElement("audio")
        audio.autoplay = true
        ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
        audio.srcObject = stream
        audio.style.display = "none"
        document.body.appendChild(audio)
        void this.applyOutputSink(audio)
        void audio.play().catch(() => {})
        this.peers.set(userId, {
            username,
            audio,
            stream,
            pc,
            lastResyncAt: 0
        })
        this.refreshGains()
    }

    private async applyOutputSink(audio: HTMLAudioElement): Promise<void> {
        const outId = getStoredOutputDeviceId()
        const el = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
        if (outId && typeof el.setSinkId === "function") {
            try {
                await el.setSinkId(outId)
            } catch {
            }
        }
    }

    private async checkJitterBuffers(): Promise<void> {
        const now = Date.now()
        for (const [, peer] of Array.from(this.peers.entries())) {
            if (!peer.pc) continue
            try {
                const stats = await peer.pc.getStats()
                let delaySec = 0
                stats.forEach((report) => {
                    if (report.type !== "inbound-rtp" || report.kind !== "audio") return
                    const emitted = Number(report.jitterBufferEmittedCount ?? 0)
                    const delay = Number(report.jitterBufferDelay ?? 0)
                    if (emitted > 0 && delay > 0) delaySec = delay / emitted
                })
                if (delaySec < JITTER_RESYNC_THRESHOLD_SEC) continue
                if (now - peer.lastResyncAt < RESYNC_COOLDOWN_MS) continue
                peer.lastResyncAt = now
                const receivers = peer.pc.getReceivers()
                for (const receiver of receivers) {
                    if (receiver.track?.kind === "audio" && "playoutDelayHint" in receiver) {
                        receiver.playoutDelayHint = PLAYOUT_DELAY_HINT_SEC
                    }
                }
                const audio = peer.audio
                const stream = peer.stream
                audio.pause()
                audio.srcObject = null
                audio.srcObject = stream
                void audio.play().catch(() => {})
            } catch {
            }
        }
    }

    detachPeer(userId: number): void {
        const peer = this.peers.get(userId)
        if (!peer) return
        peer.audio.pause()
        peer.audio.srcObject = null
        peer.audio.remove()
        this.peers.delete(userId)
    }

    private refreshGains(): void {
        const master = Number(localStorage.getItem("valueSound") || 100) / 100
        this.peers.forEach(({ username, audio }) => {
            audio.volume = Math.max(0, Math.min(1, master * getParticipantVolume(username)))
        })
    }

    async destroy(): Promise<void> {
        document.removeEventListener("pointerdown", this.resumePlayback)
        document.removeEventListener("keydown", this.resumePlayback)
        if (this.volumeTimer) {
            clearInterval(this.volumeTimer)
            this.volumeTimer = null
        }
        if (this.jitterTimer) {
            clearInterval(this.jitterTimer)
            this.jitterTimer = null
        }
        Array.from(this.peers.keys()).forEach((userId) => this.detachPeer(userId))
    }
}
