import type { Socket } from "socket.io-client"
import type { IceServerConfig, RemotePeerMeta, WebrtcContext, WebrtcSignalIncoming, WebrtcSignalType } from "./types"
import type { CallPingSample } from "./callPing"
import { readPeerConnectionRttMs } from "./callPing"
import { RemoteAudioPlayback } from "./remotePlayback"
import { getMicStream, setMicEnabled } from "./micStream"
import { parseDirectCallRoom } from "./parseDirectRoom"
import { peerDiagnostics, type CallDiagnostics } from "./diagnostics"

type PeerState = {
    userId: number
    pc: RTCPeerConnection
    username: string
    makingOffer: boolean
    negotiationRequested: boolean
    ignoreOffer: boolean
    restartRequested: boolean
    restartTimer?: ReturnType<typeof setTimeout>
    startupOfferTimer?: ReturnType<typeof setTimeout>
    screenVideoSender?: RTCRtpSender
    screenAudioSender?: RTCRtpSender
    operationTail: Promise<void>
    pendingIce: RTCIceCandidateInit[]
}

const PLAYOUT_DELAY_HINT_SEC = 0.05
const ICE_RESTART_RETRY_MS = 5_000
const STARTUP_OFFER_REPLAY_MS = 1_000
const STARTUP_OFFER_REPLAY_LIMIT = 20

export type RemoteScreenEvent = {
    userId: number
    username: string
    stream: MediaStream | null
}

export type ScreenShareListener = (ev: RemoteScreenEvent) => void

export type VoiceMeshOptions = {
    socket: Socket
    roomId: string | number
    context: WebrtcContext
    myUserId: number
    iceServers: IceServerConfig[]
    directCallerId?: number
    ownershipRevision?: number
    peerOwnershipRevision?: number
}

export class VoiceMesh {
    private readonly socket: Socket
    private readonly roomId: string | number
    private readonly context: WebrtcContext
    private readonly myUserId: number
    private readonly iceServers: IceServerConfig[]
    private readonly directCallerId: number | null
    private readonly playback = new RemoteAudioPlayback()
    private localStream: MediaStream | null = null
    private starting: Promise<MediaStream> | null = null
    private screenStream: MediaStream | null = null
    private peers = new Map<number, PeerState>()
    private remoteScreens = new Map<number, { username: string; stream: MediaStream }>()
    private screenListeners = new Set<ScreenShareListener>()
    private destroyed = false
    private reconnectAttempts = 0
    private onSignalBound: (msg: WebrtcSignalIncoming) => void
    private onScreenStateBound: (msg: WebrtcScreenStateIncoming) => void
    private localOwnershipRevision: number | undefined
    private peerOwnershipRevisions = new Map<number, number>()
    private onPeerReplacedBound: (message: PeerReplaced) => void

    constructor(opts: VoiceMeshOptions) {
        this.socket = opts.socket
        this.roomId = opts.roomId
        this.context = opts.context
        this.myUserId = opts.myUserId
        this.iceServers = opts.iceServers
        this.directCallerId = opts.directCallerId ?? null
        this.localOwnershipRevision = opts.ownershipRevision
        const directRoom = parseDirectCallRoom(String(this.roomId))
        if (directRoom && opts.peerOwnershipRevision !== undefined) {
            this.peerOwnershipRevisions.set(
                this.myUserId === directRoom.callerId ? directRoom.receiverId : directRoom.callerId,
                opts.peerOwnershipRevision
            )
        }
        this.onSignalBound = (msg) => {
            void this.handleSignal(msg).catch((error) => {
                if (!this.destroyed) console.error("[webrtc] start", error)
            })
        }
        this.onScreenStateBound = (msg) => this.handleScreenState(msg)
        this.socket.on("webrtc:signal", this.onSignalBound)
        this.socket.on("webrtc:screen:state", this.onScreenStateBound)
        this.onPeerReplacedBound = (message) => {
            if (message.context !== "direct" || String(message.roomId) !== String(this.roomId)) return
            const peerId = this.directPeerId()
            if (message.userId !== peerId || !Number.isSafeInteger(message.ownershipRevision)) return
            this.updateDirectOwnership(this.localOwnershipRevision, message.ownershipRevision)
        }
        this.socket.on("webrtc:peer:replaced", this.onPeerReplacedBound)
    }

    private directPeerId(): number | undefined {
        if (this.context !== "direct") return undefined
        const room = parseDirectCallRoom(String(this.roomId))
        return room ? (room.callerId === this.myUserId ? room.receiverId : room.callerId) : undefined
    }

    private ownershipFields(peerId = this.directPeerId()) {
        if (this.context !== "direct" || this.localOwnershipRevision === undefined) return {}
        return {
            ownershipRevision: this.localOwnershipRevision,
            targetOwnershipRevision: peerId === undefined ? undefined : this.peerOwnershipRevisions.get(peerId)
        }
    }

    private matchesOwnership(message: {
        fromUserId: number
        fromOwnershipRevision?: number
        targetOwnershipRevision?: number
    }): boolean {
        if (this.context !== "direct" || this.localOwnershipRevision === undefined) return true
        if (message.fromUserId !== this.directPeerId()) return false
        return (
            message.targetOwnershipRevision === this.localOwnershipRevision &&
            message.fromOwnershipRevision === this.peerOwnershipRevisions.get(message.fromUserId)
        )
    }

    updateDirectOwnership(local: number | undefined, remote: number | undefined): void {
        if (this.destroyed || this.context !== "direct") return
        const peerId = this.directPeerId()
        if (peerId === undefined) return
        if (local !== undefined) {
            if (this.localOwnershipRevision !== undefined && local < this.localOwnershipRevision) return
            this.localOwnershipRevision = local
        }
        if (remote === undefined || !Number.isSafeInteger(remote) || remote <= 0) return
        const previous = this.peerOwnershipRevisions.get(peerId)
        if (previous !== undefined && remote <= previous) return
        this.peerOwnershipRevisions.set(peerId, remote)
        this.clearRemoteScreen(peerId)
        this.removePeer(peerId)
        if (this.myUserId === this.directCallerId) {
            void this.startDirectCall().catch((error) => {
                if (!this.destroyed) console.error("[webrtc] device handoff", error)
            })
        }
    }

    onScreenShare(listener: ScreenShareListener): () => void {
        this.screenListeners.add(listener)
        this.remoteScreens.forEach(({ username, stream }, userId) => {
            listener({ userId, username, stream })
        })
        return () => this.screenListeners.delete(listener)
    }

    async start(): Promise<MediaStream> {
        if (this.destroyed) throw new Error("VoiceMesh destroyed")
        if (this.localStream) return this.localStream
        if (!this.starting) {
            this.starting = (async () => {
                const stream = await getMicStream()
                if (this.destroyed) {
                    stream.getTracks().forEach((track) => track.stop())
                    throw new Error("VoiceMesh destroyed")
                }
                this.localStream = stream
                const micStorage = localStorage.getItem("micState")
                const enabled = micStorage !== null ? JSON.parse(micStorage) : true
                setMicEnabled(stream, enabled)
                return stream
            })()
        }
        try {
            return await this.starting
        } finally {
            this.starting = null
        }
    }

    setMicEnabled(enabled: boolean): void {
        if (this.localStream) setMicEnabled(this.localStream, enabled)
        localStorage.setItem("micState", JSON.stringify(enabled))
    }

    async setScreenShare(stream: MediaStream | null): Promise<void> {
        if (this.destroyed) return
        this.screenStream = stream
        for (const [peerId, state] of Array.from(this.peers.entries())) {
            await this.runPeerOperation(state, async () => {
                await this.syncScreenSenders(state)
                if (this.peers.get(peerId) === state) await this.makeOffer(peerId, state)
            })
        }
        if (this.socket.connected) {
            this.socket.emit("webrtc:screen:state", {
                roomId: this.roomId,
                context: this.context,
                ...this.ownershipFields(),
                active: !!stream
            })
        }
    }

    async startDirectCall(): Promise<void> {
        if (this.context !== "direct" || this.directCallerId == null) return
        const parsed = parseDirectCallRoom(String(this.roomId))
        if (!parsed) return
        if (this.myUserId !== this.directCallerId) return
        await this.ensureOffer(parsed.receiverId, "peer")
    }

    async connectPartyPeers(participants: RemotePeerMeta[]): Promise<void> {
        if (this.context !== "party") return
        await this.start()
        for (const p of participants) {
            if (p.userId === this.myUserId) continue
            if (this.myUserId < p.userId) {
                await this.ensureOffer(p.userId, p.username)
            }
        }
    }

    async onPartyPeerJoined(peer: RemotePeerMeta): Promise<void> {
        if (this.context !== "party" || peer.userId === this.myUserId) return
        await this.start()
        await this.ensureOffer(peer.userId, peer.username)
    }

    onPartyPeerLeft(userId: number): void {
        this.clearRemoteScreen(userId)
        this.removePeer(userId)
    }

    reconnect(): void {
        if (this.destroyed) return
        this.peers.forEach((state, userId) => {
            clearTimeout(state.restartTimer)
            state.restartTimer = undefined
            this.requestIceRestart(userId, 0)
        })
    }

    private requestIceRestart(userId: number, delayMs = 1_000): void {
        const state = this.peers.get(userId)
        if (this.destroyed || !state) return
        state.restartRequested = true
        if (state.restartTimer != null) return
        state.restartTimer = setTimeout(() => {
            state.restartTimer = undefined
            void (async () => {
                try {
                    if (this.destroyed || this.peers.get(userId) !== state || !state.restartRequested) return
                    if (this.socket.connected && !state.makingOffer) {
                        this.reconnectAttempts++
                        await this.runPeerOperation(state, async () => {
                            if (state.pc.signalingState !== "stable") {
                                state.negotiationRequested = true
                                const pending = state.pc.localDescription
                                if (pending?.type === "offer" && pending.sdp) {
                                    this.sendSignal(userId, "offer", { type: pending.type, sdp: pending.sdp }, state)
                                }
                                return
                            }
                            await this.makeOffer(userId, state, true)
                        })
                    }
                } catch (err) {
                    if (!this.destroyed) console.error("[webrtc] reconnect", err)
                } finally {
                    if (state.restartRequested && this.peers.get(userId) === state) {
                        this.requestIceRestart(userId, ICE_RESTART_RETRY_MS)
                    }
                }
            })()
        }, delayMs)
    }

    private async syncScreenSenders(state: PeerState): Promise<void> {
        const pc = state.pc
        const videoTrack = this.screenStream?.getVideoTracks().find((t) => t.readyState === "live") ?? null
        const screenAudioTrack = this.screenStream?.getAudioTracks().find((t) => t.readyState === "live") ?? null

        const videoSender = state.screenVideoSender
        if (videoTrack) {
            if (videoSender) {
                await videoSender.replaceTrack(videoTrack)
                videoSender.setStreams(this.screenStream!)
            } else if (this.screenStream) {
                state.screenVideoSender = pc.addTrack(videoTrack, this.screenStream)
            }
        } else if (videoSender) {
            await videoSender.replaceTrack(null)
        }

        const screenAudioSender = state.screenAudioSender
        if (screenAudioTrack && this.screenStream) {
            if (screenAudioSender) {
                await screenAudioSender.replaceTrack(screenAudioTrack)
                screenAudioSender.setStreams(this.screenStream)
            } else {
                state.screenAudioSender = pc.addTrack(screenAudioTrack, this.screenStream)
            }
        } else if (screenAudioSender) {
            await screenAudioSender.replaceTrack(null)
        }
    }

    private createPeerConnection(remoteUserId: number, username: string): PeerState {
        const pc = new RTCPeerConnection({ iceServers: this.iceServers })
        const state: PeerState = {
            userId: remoteUserId,
            pc,
            username,
            makingOffer: false,
            negotiationRequested: false,
            ignoreOffer: false,
            operationTail: Promise.resolve(),
            pendingIce: [],
            restartRequested: false
        }

        if (this.localStream) {
            for (const track of this.localStream.getTracks()) {
                pc.addTrack(track, this.localStream)
            }
        }
        if (this.screenStream) {
            const v = this.screenStream.getVideoTracks()[0]
            const a = this.screenStream.getAudioTracks()[0]
            if (v) state.screenVideoSender = pc.addTrack(v, this.screenStream)
            if (a) state.screenAudioSender = pc.addTrack(a, this.screenStream)
        }

        pc.ontrack = (ev) => {
            const track = ev.track
            if (track.kind === "audio" && ev.receiver && "playoutDelayHint" in ev.receiver) {
                ev.receiver.playoutDelayHint = PLAYOUT_DELAY_HINT_SEC
            }
            const route = () => {
                if (this.destroyed || this.peers.get(remoteUserId) !== state) return
                this.routeRemoteTrack(remoteUserId, state.username, track, ev.streams[0])
            }
            if (track.muted) {
                track.onunmute = () => route()
            } else {
                route()
            }
        }

        pc.onicecandidate = (ev) => {
            if (!ev.candidate) return
            this.sendSignal(remoteUserId, "ice", ev.candidate.toJSON(), state)
        }

        const onConnectionChange = () => {
            if (this.destroyed || this.peers.get(remoteUserId) !== state) return
            if (pc.iceConnectionState === "failed" || pc.connectionState === "failed") {
                this.requestIceRestart(remoteUserId, 0)
            } else if (pc.iceConnectionState === "disconnected" || pc.connectionState === "disconnected") {
                this.requestIceRestart(remoteUserId)
            } else if (
                pc.connectionState === "connected" &&
                (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed")
            ) {
                state.restartRequested = false
                clearTimeout(state.restartTimer)
                state.restartTimer = undefined
            }
        }
        pc.onconnectionstatechange = onConnectionChange
        pc.oniceconnectionstatechange = onConnectionChange
        pc.onsignalingstatechange = () => {
            if (this.destroyed || this.peers.get(remoteUserId) !== state) return
            if (pc.signalingState === "stable" && state.negotiationRequested) {
                void this.renegotiate(remoteUserId, state.username)
            }
        }

        this.peers.set(remoteUserId, state)
        return state
    }

    private routeRemoteTrack(
        remoteUserId: number,
        username: string,
        track: MediaStreamTrack,
        bundled?: MediaStream
    ): void {
        if (track.kind === "video") {
            this.attachRemoteScreenTrack(remoteUserId, username, track, bundled)
            track.onended = () => this.clearRemoteScreen(remoteUserId)
            return
        }
        if (track.kind !== "audio" || track.readyState === "ended") return

        const stream = bundled ?? new MediaStream([track])
        if (stream.getVideoTracks().length > 0) {
            this.attachRemoteScreenTrack(remoteUserId, username, track, stream)
            return
        }
        this.playback.attachPeer(remoteUserId, username, stream, this.peers.get(remoteUserId)?.pc)
    }

    private attachRemoteScreenTrack(
        userId: number,
        username: string,
        track: MediaStreamTrack,
        bundled?: MediaStream
    ): void {
        let entry = this.remoteScreens.get(userId)
        if (!entry) {
            entry = { username, stream: new MediaStream() }
            this.remoteScreens.set(userId, entry)
        }
        entry.username = username
        if (!entry.stream.getTrackById(track.id)) {
            entry.stream.addTrack(track)
        }
        if (bundled) {
            for (const t of bundled.getTracks()) {
                if (t.kind === "video" || t.kind === "audio") {
                    if (!entry.stream.getTrackById(t.id)) entry.stream.addTrack(t)
                }
            }
        }
        this.emitScreen(userId, username, entry.stream)
    }

    private clearRemoteScreen(userId: number): void {
        const entry = this.remoteScreens.get(userId)
        if (!entry) return
        this.remoteScreens.delete(userId)
        this.emitScreen(userId, entry.username, null)
    }

    private emitScreen(userId: number, username: string, stream: MediaStream | null): void {
        this.screenListeners.forEach((fn) => fn({ userId, username, stream }))
    }

    private handleScreenState(msg: WebrtcScreenStateIncoming): void {
        if (this.destroyed) return
        if (msg.context !== this.context) return
        if (String(msg.roomId) !== String(this.roomId)) return
        if (msg.fromUserId === this.myUserId) return
        if (!this.matchesOwnership(msg)) return
        if (!msg.active) {
            this.clearRemoteScreen(msg.fromUserId)
        }
    }

    private getOrCreatePeer(remoteUserId: number, username: string): PeerState {
        let state = this.peers.get(remoteUserId)
        if (!state) state = this.createPeerConnection(remoteUserId, username)
        else if (username && username !== "peer") state.username = username
        return state
    }

    private async ensureOffer(remoteUserId: number, username: string): Promise<void> {
        if (this.destroyed) return
        const ownership = this.peerOwnershipRevisions.get(remoteUserId)
        await this.start()
        if (this.destroyed || ownership !== this.peerOwnershipRevisions.get(remoteUserId)) return
        const state = this.getOrCreatePeer(remoteUserId, username)
        if (state.pc.signalingState !== "stable") return
        await this.renegotiate(remoteUserId, username)
    }

    private async renegotiate(remoteUserId: number, username: string, iceRestart = false): Promise<void> {
        if (this.destroyed || !this.socket.connected) return
        const state = this.getOrCreatePeer(remoteUserId, username)
        return this.runPeerOperation(state, () => this.makeOffer(remoteUserId, state, iceRestart))
    }

    private async runPeerOperation(state: PeerState, work: () => Promise<void>): Promise<void> {
        const next = state.operationTail.then(async () => {
            if (this.destroyed || this.peers.get(state.userId) !== state || state.pc.signalingState === "closed") return
            try {
                await work()
            } catch (error) {
                if (this.destroyed || this.peers.get(state.userId) !== state) return
                throw error
            }
        })
        state.operationTail = next.catch(() => {})
        return next
    }

    private async makeOffer(remoteUserId: number, state: PeerState, iceRestart = false): Promise<void> {
        const pc = state.pc
        if (state.makingOffer || pc.signalingState !== "stable") {
            state.negotiationRequested = true
            return
        }
        const restart = iceRestart || state.restartRequested
        if (restart) {
            state.restartRequested = false
            clearTimeout(state.restartTimer)
            state.restartTimer = undefined
        }
        try {
            state.negotiationRequested = false
            state.makingOffer = true
            const offer = await pc.createOffer(restart ? { iceRestart: true } : undefined)
            if (this.destroyed || this.peers.get(remoteUserId) !== state) return
            await pc.setLocalDescription(offer)
            if (this.destroyed || this.peers.get(remoteUserId) !== state) return
            this.sendSignal(remoteUserId, "offer", offer, state)
            this.scheduleStartupOfferReplay(remoteUserId, state)
        } catch (err) {
            if (!this.destroyed && this.peers.get(remoteUserId) === state) {
                if (restart) this.requestIceRestart(remoteUserId, ICE_RESTART_RETRY_MS)
                console.error("[webrtc] renegotiate", err)
            }
        } finally {
            state.makingOffer = false
            if (state.negotiationRequested && pc.signalingState === "stable") {
                void this.renegotiate(remoteUserId, state.username)
            }
        }
    }

    private scheduleStartupOfferReplay(remoteUserId: number, state: PeerState, attempt = 0): void {
        clearTimeout(state.startupOfferTimer)
        state.startupOfferTimer = undefined
        if (
            this.context !== "direct" ||
            this.myUserId !== this.directCallerId ||
            state.pc.remoteDescription ||
            state.pc.signalingState !== "have-local-offer" ||
            attempt >= STARTUP_OFFER_REPLAY_LIMIT
        )
            return

        state.startupOfferTimer = setTimeout(() => {
            state.startupOfferTimer = undefined
            if (
                this.destroyed ||
                this.peers.get(remoteUserId) !== state ||
                !this.socket.connected ||
                state.pc.remoteDescription ||
                state.pc.signalingState !== "have-local-offer"
            )
                return
            const description = state.pc.localDescription
            if (description?.type !== "offer" || !description.sdp) return
            this.sendSignal(remoteUserId, "offer", { type: description.type, sdp: description.sdp }, state)
            this.scheduleStartupOfferReplay(remoteUserId, state, attempt + 1)
        }, STARTUP_OFFER_REPLAY_MS)
    }

    private async handleSignal(msg: WebrtcSignalIncoming): Promise<void> {
        if (this.destroyed) return
        if (msg.context !== this.context) return
        if (String(msg.roomId) !== String(this.roomId)) return
        if (msg.fromUserId === this.myUserId) return
        if (!this.matchesOwnership(msg)) return

        await this.start()
        if (this.destroyed || !this.matchesOwnership(msg)) return
        const remoteUserId = msg.fromUserId
        const username = msg.fromUsername ?? "peer"
        const state = this.getOrCreatePeer(remoteUserId, username)
        const pc = state.pc

        await this.runPeerOperation(state, async () => {
            if (this.peers.get(remoteUserId) !== state || !this.matchesOwnership(msg)) return
            try {
                if (msg.type === "offer") {
                    const offerCollision = state.makingOffer || pc.signalingState !== "stable"
                    state.ignoreOffer = !this.isPolite(remoteUserId) && offerCollision
                    if (state.ignoreOffer) return

                    await pc.setRemoteDescription(msg.payload as RTCSessionDescriptionInit)
                    await this.flushPendingIce(state)
                    if (this.destroyed || this.peers.get(remoteUserId) !== state || !this.matchesOwnership(msg)) return
                    const answer = await pc.createAnswer()
                    if (this.destroyed || this.peers.get(remoteUserId) !== state) return
                    await pc.setLocalDescription(answer)
                    this.sendSignal(remoteUserId, "answer", answer, state)
                } else if (msg.type === "answer") {
                    if (pc.signalingState !== "have-local-offer") return
                    await pc.setRemoteDescription(msg.payload as RTCSessionDescriptionInit)
                    clearTimeout(state.startupOfferTimer)
                    state.startupOfferTimer = undefined
                    state.ignoreOffer = false
                    await this.flushPendingIce(state)
                } else if (msg.type === "ice") {
                    if (state.ignoreOffer) return
                    if (!pc.remoteDescription) {
                        if (state.pendingIce.length < 256) state.pendingIce.push(msg.payload as RTCIceCandidateInit)
                        return
                    }
                    try {
                        await pc.addIceCandidate(msg.payload as RTCIceCandidateInit)
                    } catch {
                    }
                }
            } catch (err) {
                if (!this.destroyed && this.peers.get(remoteUserId) === state)
                    console.error("[webrtc] handleSignal", msg.type, err)
            }
        })
    }

    private async flushPendingIce(state: PeerState): Promise<void> {
        const pending = state.pendingIce.splice(0)
        for (const candidate of pending) {
            try {
                await state.pc.addIceCandidate(candidate)
            } catch {
            }
        }
    }

    private isPolite(remoteUserId: number): boolean {
        return this.myUserId < remoteUserId
    }

    private sendSignal(
        targetUserId: number,
        type: WebrtcSignalType,
        payload: RTCSessionDescriptionInit | RTCIceCandidateInit,
        expectedPeer?: PeerState
    ): void {
        if (this.destroyed || !this.socket.connected) return
        if (expectedPeer && this.peers.get(targetUserId) !== expectedPeer) return
        this.socket.emit("webrtc:signal", {
            roomId: this.roomId,
            context: this.context,
            ...this.ownershipFields(targetUserId),
            type,
            targetUserId,
            payload
        })
    }

    private removePeer(userId: number): void {
        const state = this.peers.get(userId)
        if (!state) return
        this.peers.delete(userId)
        clearTimeout(state.restartTimer)
        clearTimeout(state.startupOfferTimer)
        state.pc.close()
        this.playback.detachPeer(userId)
    }

    async getPingSample(): Promise<CallPingSample> {
        if (this.destroyed || this.peers.size === 0) {
            return { rttMs: null, peerCount: 0 }
        }
        let rttMs: number | null = null
        for (const sample of await Promise.all(
            Array.from(this.peers.values(), (state) => readPeerConnectionRttMs(state.pc))
        )) {
            if (sample != null && (rttMs == null || sample > rttMs)) {
                rttMs = sample
            }
        }
        return { rttMs, peerCount: this.peers.size }
    }

    async getDiagnostics(): Promise<CallDiagnostics> {
        const track = this.localStream?.getAudioTracks()[0]
        return {
            capturedAt: new Date().toISOString(),
            microphone: {
                available: track?.readyState === "live",
                enabled: !!track?.enabled,
                device: track?.label || null
            },
            reconnectAttempts: this.reconnectAttempts,
            peers: await Promise.all(Array.from(this.peers.values(), (peer) => peerDiagnostics(peer.pc)))
        }
    }

    async destroy(): Promise<void> {
        if (this.destroyed) return
        this.destroyed = true
        this.socket.off("webrtc:signal", this.onSignalBound)
        this.socket.off("webrtc:screen:state", this.onScreenStateBound)
        this.socket.off("webrtc:peer:replaced", this.onPeerReplacedBound)
        if (this.socket.connected && this.screenStream) {
            this.socket.emit("webrtc:screen:state", {
                roomId: this.roomId,
                context: this.context,
                ...this.ownershipFields(),
                active: false
            })
        }
        for (const userId of Array.from(this.peers.keys())) {
            this.removePeer(userId)
        }
        this.remoteScreens.clear()
        this.screenListeners.clear()
        this.screenStream = null
        this.localStream?.getTracks().forEach((t) => t.stop())
        this.localStream = null
        await this.playback.destroy()
    }
}

type WebrtcScreenStateIncoming = {
    fromOwnershipRevision?: number
    targetOwnershipRevision?: number
    roomId: string | number
    context: WebrtcContext
    fromUserId: number
    fromUsername?: string
    active: boolean
}

type PeerReplaced = {
    roomId: string | number
    context: WebrtcContext
    userId: number
    ownershipRevision: number
}

export function waitForWebrtcConfig(socket: Socket, timeoutMs = 8000): Promise<IceServerConfig[]> {
    return new Promise((resolve) => {
        const fallback: IceServerConfig[] = [{ urls: "stun:stun.l.google.com:19302" }]
        let settled = false
        const finish = (servers: IceServerConfig[]) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            socket.off("webrtc:config", onConfig)
            resolve(servers.length ? servers : fallback)
        }
        const onConfig = (data: { iceServers?: IceServerConfig[] }) => {
            finish(Array.isArray(data?.iceServers) ? data.iceServers : fallback)
        }
        socket.on("webrtc:config", onConfig)
        const timer = setTimeout(() => finish(fallback), timeoutMs)
        if (socket.connected) {
            socket.emit("webrtc:config:request")
        }
    })
}
