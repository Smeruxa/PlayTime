import type { Socket } from "socket.io-client"
import { VoiceMesh } from "./voiceMesh"
import type { WebrtcSignalIncoming } from "./types"
import { getMicStream } from "./micStream"

jest.mock("./micStream", () => ({ getMicStream: jest.fn(), setMicEnabled: jest.fn() }))

type OutgoingSignal = Omit<WebrtcSignalIncoming, "fromUserId" | "fromUsername"> & { targetUserId: number }

class SignalingSocket {
    connected = true
    private listener?: (message: WebrtcSignalIncoming) => void

    constructor(
        private readonly bus: Map<number, SignalingSocket>,
        private readonly userId: number
    ) {
        bus.set(userId, this)
    }

    on(event: string, listener: (message: WebrtcSignalIncoming) => void) {
        if (event === "webrtc:signal") this.listener = listener
    }

    off(event: string, listener: (message: WebrtcSignalIncoming) => void) {
        if (event === "webrtc:signal" && this.listener === listener) this.listener = undefined
    }

    emit = jest.fn((event: string, signal: OutgoingSignal) => {
        if (event !== "webrtc:signal") return
        this.bus.get(signal.targetUserId)?.listener?.({
            roomId: signal.roomId,
            context: signal.context,
            type: signal.type,
            payload: signal.payload,
            fromUserId: this.userId,
            fromUsername: `peer-${this.userId}`
        })
    })
}

class MicrophoneStream {
    readonly track = { id: "mic", kind: "audio", enabled: true, stop: jest.fn() }
    getTracks() {
        return [this.track]
    }
    getAudioTracks() {
        return [this.track]
    }
}

class PeerConnection {
    signalingState: RTCSignalingState = "stable"
    localDescription: RTCSessionDescriptionInit | null = null
    remoteDescription: RTCSessionDescriptionInit | null = null
    onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null
    createOffer = jest.fn(async () => ({ type: "offer", sdp: "initial-offer" }))
    createAnswer = jest.fn(async () => ({ type: "answer", sdp: "answer" }))
    setLocalDescription = jest.fn(async (description: RTCSessionDescriptionInit) => {
        this.localDescription = { ...description }
        this.signalingState = description.type === "offer" ? "have-local-offer" : "stable"
    })
    setRemoteDescription = jest.fn(async (description: RTCSessionDescriptionInit) => {
        this.remoteDescription = { ...description }
        this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable"
    })
    addTrack = jest.fn()
    addIceCandidate = jest.fn(async () => {})
    close = jest.fn()
}

describe("direct-call signalling before the callee media hook is ready", () => {
    const originalConnection = global.RTCPeerConnection
    const connections: PeerConnection[] = []
    const meshes: VoiceMesh[] = []
    const microphones: MicrophoneStream[] = []
    let sockets: Map<number, SignalingSocket>

    const flush = async () => {
        for (let index = 0; index < 30; index++) await Promise.resolve()
    }
    const startMesh = (socket: SignalingSocket, userId: number) => {
        const mesh = new VoiceMesh({
            socket: socket as unknown as Socket,
            roomId: "1:2:00000000-0000-4000-8000-000000000001",
            context: "direct",
            myUserId: userId,
            directCallerId: 1,
            iceServers: []
        })
        meshes.push(mesh)
        return mesh
    }

    beforeEach(() => {
        jest.useFakeTimers()
        sockets = new Map()
        connections.length = 0
        meshes.length = 0
        microphones.length = 0
        ;(getMicStream as jest.Mock).mockReset().mockImplementation(async () => {
            const stream = new MicrophoneStream()
            microphones.push(stream)
            return stream as unknown as MediaStream
        })
        global.RTCPeerConnection = jest.fn(() => {
            const connection = new PeerConnection()
            connections.push(connection)
            return connection
        }) as unknown as typeof RTCPeerConnection
    })

    afterEach(async () => {
        for (const mesh of meshes) await mesh.destroy()
        global.RTCPeerConnection = originalConnection
        jest.useRealTimers()
    })

    it("answers after losing the initial offer and ICE before delayed callee construction", async () => {
        const callerSocket = new SignalingSocket(sockets, 1)
        const calleeSocket = new SignalingSocket(sockets, 2)
        const caller = startMesh(callerSocket, 1)
        await caller.startDirectCall()
        expect(connections).toHaveLength(1)
        const callerPc = connections[0]
        callerPc.onicecandidate?.({
            candidate: { toJSON: () => ({ candidate: "early-candidate" }) }
        } as unknown as RTCPeerConnectionIceEvent)
        callerPc.localDescription = { type: "offer", sdp: "offer-with-gathered-candidates" }
        jest.advanceTimersByTime(3_000)
        await flush()
        expect(connections).toHaveLength(1)
        expect(callerPc.remoteDescription).toBeNull()

        const callee = startMesh(calleeSocket, 2)
        await callee.start()
        await callee.startDirectCall()
        jest.advanceTimersByTime(1_000)
        await flush()

        expect(connections).toHaveLength(2)
        expect(connections[1].remoteDescription?.sdp).toBe("offer-with-gathered-candidates")
        expect(callerPc.remoteDescription?.type).toBe("answer")
        expect(callerPc.createOffer).toHaveBeenCalledTimes(1)
        expect(getMicStream).toHaveBeenCalledTimes(2)
        expect(microphones.every((stream) => stream.track.stop.mock.calls.length === 0)).toBe(true)
        const sent = callerSocket.emit.mock.calls.length
        jest.advanceTimersByTime(30_000)
        await flush()
        expect(callerSocket.emit).toHaveBeenCalledTimes(sent)
    })

    it("bounds unanswered startup replay instead of emitting forever", async () => {
        const socket = new SignalingSocket(sockets, 1)
        await startMesh(socket, 1).startDirectCall()
        jest.advanceTimersByTime(60_000)
        await flush()
        const sent = socket.emit.mock.calls.length
        expect(sent).toBeGreaterThan(1)
        expect(sent).toBeLessThanOrEqual(21)
        jest.advanceTimersByTime(60_000)
        await flush()
        expect(socket.emit).toHaveBeenCalledTimes(sent)
        expect(connections[0].createOffer).toHaveBeenCalledTimes(1)
        expect(getMicStream).toHaveBeenCalledTimes(1)
    })

    it.each(["destroyed", "offline"])("stops startup replay when the call is %s", async (reason) => {
        const socket = new SignalingSocket(sockets, 1)
        const mesh = startMesh(socket, 1)
        await mesh.startDirectCall()
        if (reason === "destroyed") await mesh.destroy()
        else socket.connected = false
        const sent = socket.emit.mock.calls.length
        jest.advanceTimersByTime(30_000)
        await flush()
        expect(socket.emit).toHaveBeenCalledTimes(sent)
    })
})
