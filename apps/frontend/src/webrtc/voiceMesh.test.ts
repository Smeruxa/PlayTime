import type { Socket } from "socket.io-client"
import { VoiceMesh } from "./voiceMesh"
import { getMicStream } from "./micStream"
import { setParticipantVolume } from "../conversation/participantVolume"

jest.mock("./micStream", () => ({
    getMicStream: jest.fn(),
    setMicEnabled: jest.fn()
}))

class TestStream extends EventTarget {
    constructor(private tracks: MediaStreamTrack[] = []) {
        super()
    }
    getTracks() {
        return [...this.tracks]
    }
    getAudioTracks() {
        return this.tracks.filter((track) => track.kind === "audio")
    }
    getVideoTracks() {
        return this.tracks.filter((track) => track.kind === "video")
    }
    getTrackById(id: string) {
        return this.tracks.find((track) => track.id === id) ?? null
    }
    addTrack(track: MediaStreamTrack) {
        this.tracks.push(track)
        this.dispatchEvent(new Event("addtrack"))
    }
    removeTrack(track: MediaStreamTrack) {
        this.tracks = this.tracks.filter((item) => item !== track)
        this.dispatchEvent(new Event("removetrack"))
    }
}

function track(id: string, kind: "audio" | "video"): MediaStreamTrack {
    return { id, kind, readyState: "live", muted: false, stop: jest.fn() } as unknown as MediaStreamTrack
}

class TestConnection {
    signalingState = "stable"
    connectionState = "connected"
    iceConnectionState = "connected"
    onconnectionstatechange: (() => void) | null = null
    oniceconnectionstatechange: (() => void) | null = null
    onsignalingstatechange: (() => void) | null = null
    localDescription: RTCSessionDescriptionInit | null = null
    remoteDescription: RTCSessionDescriptionInit | null = null
    ontrack: ((event: RTCTrackEvent) => void) | null = null
    senders: { track: MediaStreamTrack | null; replaceTrack: jest.Mock; setStreams: jest.Mock }[] = []
    addTrack(track: MediaStreamTrack) {
        const sender = { track: track as MediaStreamTrack | null, replaceTrack: jest.fn(), setStreams: jest.fn() }
        sender.replaceTrack.mockImplementation(async (next) => {
            sender.track = next
        })
        this.senders.push(sender)
        return sender
    }
    getSenders() {
        return this.senders
    }
    createOffer = jest.fn(async () => ({ type: "offer", sdp: "test" }))
    setLocalDescription = jest.fn(async () => {})
    setRemoteDescription = jest.fn(async (description: RTCSessionDescriptionInit) => {
        this.remoteDescription = description
    })
    createAnswer = jest.fn(async () => ({ type: "answer", sdp: "test" }))
    addIceCandidate = jest.fn(async () => {})
    close = jest.fn()
}

describe("voice playback during local screen sharing", () => {
    let mesh: VoiceMesh
    let pc: TestConnection
    let voiceStream: MediaStream
    let incomingSignal: (message: any) => void
    const originals = { MediaStream: global.MediaStream, RTCPeerConnection: global.RTCPeerConnection }

    beforeEach(async () => {
        jest.useFakeTimers()
        localStorage.clear()
        localStorage.setItem("valueSound", "80")
        setParticipantVolume("friend", 50)
        jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
        jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
        global.MediaStream = TestStream as unknown as typeof MediaStream
        pc = new TestConnection()
        global.RTCPeerConnection = jest.fn(() => pc) as unknown as typeof RTCPeerConnection
        ;(getMicStream as jest.Mock).mockResolvedValue(new MediaStream([track("mic", "audio")]))
        const socket = { on: jest.fn(), off: jest.fn(), emit: jest.fn(), connected: true }
        mesh = new VoiceMesh({
            socket: socket as unknown as Socket,
            roomId: 1,
            context: "party",
            myUserId: 1,
            iceServers: []
        })
        incomingSignal = socket.on.mock.calls.find(([name]) => name === "webrtc:signal")![1]
        await mesh.connectPartyPeers([{ userId: 2, username: "friend" }])
        const voice = track("remote-mic", "audio")
        voiceStream = new MediaStream([voice])
        pc.ontrack!({ track: voice, streams: [voiceStream], receiver: {} } as unknown as RTCTrackEvent)
    })

    afterEach(async () => {
        await mesh.destroy()
        setParticipantVolume("friend", 100)
        localStorage.clear()
        global.MediaStream = originals.MediaStream
        global.RTCPeerConnection = originals.RTCPeerConnection
        jest.restoreAllMocks()
        jest.useRealTimers()
    })

    function expectVoiceUnchanged(audio: HTMLAudioElement) {
        expect(document.querySelector("audio")).toBe(audio)
        expect(audio.srcObject).toBe(voiceStream)
        expect(audio.volume).toBeCloseTo(0.4)
        expect(audio.muted).toBe(false)
        expect(audio.pause).not.toHaveBeenCalled()
        expect(voiceStream.getAudioTracks()[0].stop).not.toHaveBeenCalled()
    }

    it.each([false, true])(
        "keeps the same audible peer when sharing, stopping and restarting (system audio: %s)",
        async (systemAudio) => {
            const audio = document.querySelector("audio")!
            const tracks = [track("screen", "video")]
            if (systemAudio) tracks.push(track("system", "audio"))
            const screen = new MediaStream(tracks)
            expectVoiceUnchanged(audio)
            await mesh.setScreenShare(screen)
            jest.advanceTimersByTime(800)
            expectVoiceUnchanged(audio)
            expect(pc.getSenders().some((sender) => sender.track?.id === "mic")).toBe(true)
            await mesh.setScreenShare(null)
            expectVoiceUnchanged(audio)
            await mesh.setScreenShare(screen)
            expectVoiceUnchanged(audio)
            expect(pc.getSenders()).toHaveLength(systemAudio ? 3 : 2)
        }
    )

    it("keeps voice audible when screen audio tracks are added or removed", async () => {
        const audio = document.querySelector("audio")!
        const screen = new MediaStream([track("screen", "video")])
        await mesh.setScreenShare(screen)
        const system = track("system", "audio")
        screen.addTrack(system)
        jest.advanceTimersByTime(800)
        expectVoiceUnchanged(audio)
        screen.removeTrack(system)
        expectVoiceUnchanged(audio)
    })

    it("reuses screen senders with the new stream on restart and leaves the microphone alone", async () => {
        const first = new MediaStream([track("screen-1", "video"), track("system-1", "audio")])
        const second = new MediaStream([track("screen-2", "video"), track("system-2", "audio")])
        await mesh.setScreenShare(first)
        const [mic, video, audio] = pc.getSenders()
        await mesh.setScreenShare(null)
        expect(video.track).toBeNull()
        expect(audio.track).toBeNull()
        await mesh.setScreenShare(second)
        expect(pc.getSenders()).toEqual([mic, video, audio])
        expect(video.track).toBe(second.getVideoTracks()[0])
        expect(audio.track).toBe(second.getAudioTracks()[0])
        expect(video.setStreams).toHaveBeenLastCalledWith(second)
        expect(audio.setStreams).toHaveBeenLastCalledWith(second)
        expect(mic.replaceTrack).not.toHaveBeenCalled()
    })

    it("queues ICE arriving before the remote offer instead of dropping it", async () => {
        const message = { fromUserId: 2, fromUsername: "friend", roomId: 1, context: "party" }
        const candidate = { candidate: "candidate:test" }
        incomingSignal({ ...message, type: "ice", payload: candidate })
        for (let i = 0; i < 10; i++) await Promise.resolve()
        expect(pc.addIceCandidate).not.toHaveBeenCalled()
        incomingSignal({ ...message, type: "offer", payload: { type: "offer", sdp: "test" } })
        for (let i = 0; i < 10; i++) await Promise.resolve()
        expect(pc.addIceCandidate).toHaveBeenCalledWith(candidate)
    })

    it("acquires one microphone while concurrent signalling waits for permission", async () => {
        const waiting = new VoiceMesh({
            socket: { on: jest.fn(), off: jest.fn(), connected: false } as unknown as Socket,
            roomId: 2,
            context: "party",
            myUserId: 1,
            iceServers: []
        })
        let resolve!: (stream: MediaStream) => void
        const pending = new Promise<MediaStream>((done) => {
            resolve = done
        })
        ;(getMicStream as jest.Mock).mockClear().mockReturnValue(pending)
        try {
            const first = waiting.start()
            const second = waiting.start()
            expect(getMicStream).toHaveBeenCalledTimes(1)
            const mic = new MediaStream([track("waiting-mic", "audio")])
            resolve(mic)
            expect(await first).toBe(mic)
            expect(await second).toBe(mic)
        } finally {
            await waiting.destroy()
        }
    })
})

describe("voice connection recovery after a network change", () => {
    let mesh: VoiceMesh
    let pc: TestConnection
    let socket: { on: jest.Mock; off: jest.Mock; emit: jest.Mock; connected: boolean }
    let mic: MediaStream
    const originalConnection = global.RTCPeerConnection
    const originalStream = global.MediaStream
    const flush = async () => {
        for (let i = 0; i < 20; i++) await Promise.resolve()
    }

    beforeEach(async () => {
        jest.useFakeTimers()
        global.MediaStream = TestStream as unknown as typeof MediaStream
        pc = new TestConnection()
        global.RTCPeerConnection = jest.fn(() => pc) as unknown as typeof RTCPeerConnection
        mic = new MediaStream([track("mic", "audio")])
        ;(getMicStream as jest.Mock).mockClear().mockResolvedValue(mic)
        socket = { on: jest.fn(), off: jest.fn(), emit: jest.fn(), connected: true }
        mesh = new VoiceMesh({
            socket: socket as unknown as Socket,
            roomId: "1:2",
            context: "direct",
            myUserId: 1,
            directCallerId: 1,
            iceServers: []
        })
        await mesh.startDirectCall()
        pc.createOffer.mockClear()
        socket.emit.mockClear()
    })

    afterEach(async () => {
        await mesh.destroy()
        global.RTCPeerConnection = originalConnection
        global.MediaStream = originalStream
        jest.useRealTimers()
    })

    it("routes delayed direct-call tracks using the resolved peer name", async () => {
        const screens = jest.fn()
        mesh.onScreenShare(screens)
        const video = { ...track("remote-screen", "video"), muted: true } as MediaStreamTrack
        pc.ontrack!({ track: video, streams: [new MediaStream([video])], receiver: {} } as unknown as RTCTrackEvent)
        const incoming = socket.on.mock.calls.find(([name]) => name === "webrtc:signal")![1]
        incoming({
            roomId: "1:2",
            context: "direct",
            fromUserId: 2,
            fromUsername: "mira",
            type: "answer",
            payload: { type: "answer", sdp: "test" }
        })
        await flush()
        ;(video.onunmute as unknown as () => void)()
        expect(screens).toHaveBeenCalledWith(expect.objectContaining({ userId: 2, username: "mira" }))
    })

    it("ignores a remote track that unmutes after the call has closed", async () => {
        const screens = jest.fn()
        mesh.onScreenShare(screens)
        const video = { ...track("late-screen", "video"), muted: true } as MediaStreamTrack
        pc.ontrack!({ track: video, streams: [new MediaStream([video])], receiver: {} } as unknown as RTCTrackEvent)
        await mesh.destroy()
        ;(video.onunmute as unknown as () => void)()
        expect(screens).not.toHaveBeenCalled()
    })

    it("sends a new ICE offer on failure and keeps microphone and screen tracks", async () => {
        const screen = new MediaStream([track("screen", "video"), track("system", "audio")])
        await mesh.setScreenShare(screen)
        pc.createOffer.mockClear()
        pc.iceConnectionState = "failed"
        pc.oniceconnectionstatechange!()
        jest.advanceTimersByTime(0)
        await flush()
        expect(pc.createOffer).toHaveBeenCalledWith({ iceRestart: true })
        expect(socket.emit).toHaveBeenCalledWith(
            "webrtc:signal",
            expect.objectContaining({ type: "offer", targetUserId: 2 })
        )
        expect(pc.getSenders().map((sender) => sender.track?.id)).toEqual(["mic", "screen", "system"])
        expect(mic.getTracks()[0].stop).not.toHaveBeenCalled()
        expect(getMicStream).toHaveBeenCalledTimes(1)
        expect(pc.close).not.toHaveBeenCalled()
    })

    it("tolerates a short interruption, recovers each persistent failure, and stops when connected", async () => {
        pc.connectionState = "disconnected"
        pc.iceConnectionState = "disconnected"
        pc.onconnectionstatechange!()
        jest.advanceTimersByTime(500)
        pc.connectionState = "connected"
        pc.iceConnectionState = "connected"
        pc.onconnectionstatechange!()
        jest.advanceTimersByTime(1_000)
        await flush()
        expect(pc.createOffer).not.toHaveBeenCalled()

        pc.connectionState = "disconnected"
        pc.iceConnectionState = "disconnected"
        pc.onconnectionstatechange!()
        jest.advanceTimersByTime(1_000)
        await flush()
        jest.advanceTimersByTime(5_000)
        await flush()
        expect(pc.createOffer).toHaveBeenCalledTimes(1)
        pc.iceConnectionState = "failed"
        pc.oniceconnectionstatechange!()
        jest.advanceTimersByTime(0)
        await flush()
        expect(pc.createOffer).toHaveBeenCalledTimes(2)
        pc.connectionState = "connected"
        pc.iceConnectionState = "connected"
        pc.onconnectionstatechange!()
        jest.advanceTimersByTime(20_000)
        await flush()
        expect(pc.createOffer).toHaveBeenCalledTimes(2)
    })

    it("replays pending SDP without rollback and coalesces ICE recovery until the answer is stable", async () => {
        socket.connected = false
        pc.connectionState = "failed"
        pc.onconnectionstatechange!()
        jest.advanceTimersByTime(0)
        await flush()
        expect(socket.emit).not.toHaveBeenCalled()
        expect(pc.createOffer).not.toHaveBeenCalled()

        socket.connected = true
        pc.signalingState = "have-local-offer"
        pc.localDescription = { type: "offer", sdp: "m=audio\r\na=mid:0\r\nm=video\r\na=mid:1\r\n" }
        pc.setLocalDescription.mockClear()
        mesh.reconnect()
        mesh.reconnect()
        jest.advanceTimersByTime(0)
        await flush()
        expect(pc.setLocalDescription).not.toHaveBeenCalled()
        expect(pc.createOffer).not.toHaveBeenCalled()
        expect(socket.emit).toHaveBeenCalledTimes(1)
        expect(socket.emit).toHaveBeenCalledWith(
            "webrtc:signal",
            expect.objectContaining({
                type: "offer",
                payload: pc.localDescription
            })
        )
        pc.signalingState = "stable"
        pc.remoteDescription = { type: "answer", sdp: "accepted-mid-1" }
        pc.onsignalingstatechange!()
        await flush()
        expect(pc.createOffer).toHaveBeenCalledTimes(1)
        expect(pc.createOffer).toHaveBeenCalledWith({ iceRestart: true })
        expect(pc.setLocalDescription).not.toHaveBeenCalledWith({ type: "rollback" })
        expect(getMicStream).toHaveBeenCalledTimes(1)
    })

    it("retries a failed ICE offer without reacquiring media", async () => {
        const errors = jest.spyOn(console, "error").mockImplementation(() => {})
        try {
            pc.createOffer.mockRejectedValueOnce(new Error("temporary SDP failure"))
            mesh.reconnect()
            jest.advanceTimersByTime(0)
            await flush()
            expect(pc.createOffer).toHaveBeenCalledTimes(1)
            expect(socket.emit).not.toHaveBeenCalled()
            jest.advanceTimersByTime(5_000)
            await flush()
            expect(pc.createOffer).toHaveBeenCalledTimes(2)
            expect(pc.createOffer).toHaveBeenLastCalledWith({ iceRestart: true })
            expect(socket.emit).toHaveBeenCalledWith("webrtc:signal", expect.objectContaining({ type: "offer" }))
            expect(getMicStream).toHaveBeenCalledTimes(1)
        } finally {
            errors.mockRestore()
        }
    })

    it("cancels recovery when the call is closed", async () => {
        mesh.reconnect()
        await mesh.destroy()
        jest.advanceTimersByTime(20_000)
        await flush()
        expect(pc.createOffer).not.toHaveBeenCalled()
        expect(pc.close).toHaveBeenCalledTimes(1)
    })

    it("negotiates screen changes queued while a recovery offer is outstanding", async () => {
        pc.signalingState = "have-local-offer"
        await mesh.setScreenShare(new MediaStream([track("screen", "video")]))
        expect(pc.createOffer).not.toHaveBeenCalled()
        pc.signalingState = "stable"
        pc.onsignalingstatechange!()
        await flush()
        expect(pc.createOffer).toHaveBeenCalledTimes(1)
        expect(pc.getSenders().map((sender) => sender.track?.id)).toEqual(["mic", "screen"])
    })
})

describe("direct call endpoint ownership", () => {
    let mesh: VoiceMesh
    let socket: { on: jest.Mock; off: jest.Mock; emit: jest.Mock; connected: boolean }
    let connections: TestConnection[]
    let mic: MediaStream
    const originals = { connection: global.RTCPeerConnection, stream: global.MediaStream }
    const flush = async () => {
        for (let index = 0; index < 30; index++) await Promise.resolve()
    }
    const listener = (event: string) => socket.on.mock.calls.find(([name]) => name === event)![1]
    const signal = (fromRevision: number, targetRevision = 1) => ({
        context: "direct",
        roomId: "1:2",
        fromUserId: 2,
        fromUsername: "mira",
        fromOwnershipRevision: fromRevision,
        targetOwnershipRevision: targetRevision,
        type: "offer",
        payload: { type: "offer", sdp: "remote-offer" }
    })
    beforeEach(async () => {
        jest.useFakeTimers()
        global.MediaStream = TestStream as unknown as typeof MediaStream
        connections = []
        global.RTCPeerConnection = jest.fn(() => {
            const connection = new TestConnection()
            connections.push(connection)
            return connection
        }) as unknown as typeof RTCPeerConnection
        mic = new MediaStream([track("mic", "audio")])
        ;(getMicStream as jest.Mock).mockClear().mockResolvedValue(mic)
        socket = { on: jest.fn(), off: jest.fn(), emit: jest.fn(), connected: true }
        mesh = new VoiceMesh({
            socket: socket as unknown as Socket,
            roomId: "1:2",
            context: "direct",
            myUserId: 1,
            directCallerId: 1,
            ownershipRevision: 1,
            peerOwnershipRevision: 1,
            iceServers: []
        })
        await mesh.startDirectCall()
        socket.emit.mockClear()
    })
    afterEach(async () => {
        await mesh.destroy()
        global.RTCPeerConnection = originals.connection
        global.MediaStream = originals.stream
        jest.useRealTimers()
    })
    it("replaces only the peer and reuses the microphone and current screen tracks", async () => {
        const screen = new MediaStream([track("screen", "video"), track("system", "audio")])
        await mesh.setScreenShare(screen)
        socket.emit.mockClear()
        listener("webrtc:peer:replaced")({ context: "direct", roomId: "1:2", userId: 2, ownershipRevision: 2 })
        await flush()
        expect(connections).toHaveLength(2)
        expect(connections[0].close).toHaveBeenCalledTimes(1)
        expect(connections[1].getSenders().map((sender) => sender.track?.id)).toEqual(["mic", "screen", "system"])
        expect(getMicStream).toHaveBeenCalledTimes(1)
        for (const local of [...mic.getTracks(), ...screen.getTracks()]) expect(local.stop).not.toHaveBeenCalled()
        expect(socket.emit).toHaveBeenCalledWith(
            "webrtc:signal",
            expect.objectContaining({
                type: "offer",
                ownershipRevision: 1,
                targetOwnershipRevision: 2
            })
        )
        listener("webrtc:peer:replaced")({ context: "direct", roomId: "1:2", userId: 2, ownershipRevision: 1 })
        await flush()
        expect(connections).toHaveLength(2)
    })
    it("rejects stale source and target epochs before SDP and accepts the current owner", async () => {
        mesh.updateDirectOwnership(1, 2)
        await flush()
        const current = connections[1]
        listener("webrtc:signal")(signal(1))
        listener("webrtc:signal")(signal(2, 0))
        listener("webrtc:signal")({ ...signal(2), fromUserId: 3 })
        await flush()
        expect(current.setRemoteDescription).not.toHaveBeenCalled()
        listener("webrtc:signal")(signal(2))
        await flush()
        expect(current.setRemoteDescription).toHaveBeenCalledWith({ type: "offer", sdp: "remote-offer" })
        expect(current.createAnswer).toHaveBeenCalledTimes(1)
    })
    it("abandons old asynchronous SDP after the endpoint was replaced", async () => {
        const previous = connections[0]
        let finishRemote!: () => void
        previous.setRemoteDescription.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishRemote = resolve
                })
        )
        listener("webrtc:signal")(signal(1))
        await flush()
        expect(previous.setRemoteDescription).toHaveBeenCalledTimes(1)
        listener("webrtc:peer:replaced")({ context: "direct", roomId: "1:2", userId: 2, ownershipRevision: 2 })
        await flush()
        socket.emit.mockClear()
        finishRemote()
        await flush()
        expect(previous.close).toHaveBeenCalledTimes(1)
        expect(previous.createAnswer).not.toHaveBeenCalled()
        expect(socket.emit).not.toHaveBeenCalledWith("webrtc:signal", expect.objectContaining({ type: "answer" }))
    })
})
