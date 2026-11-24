import { VoiceMesh } from "../../apps/frontend/src/webrtc/voiceMesh"
const w = window as any
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
w.benchmark = async (count: number, iceServers: RTCIceServer[] | Record<number, RTCIceServer[]> = []) => {
    const audio = new AudioContext()
    await audio.resume()
    const source = audio.createOscillator(),
        gain = audio.createGain(),
        destination = audio.createMediaStreamDestination()
    source.frequency.value = 440
    gain.gain.value = 0.04
    source.connect(gain).connect(destination)
    source.start()
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => destination.stream.clone()
    })
    localStorage.setItem("valueSound", "1")
    const connections: RTCPeerConnection[] = [],
        Original = window.RTCPeerConnection
    w.RTCPeerConnection = class extends Original {
        constructor(config: RTCConfiguration) {
            super({
                ...config,
                ...(!Array.isArray(iceServers) || iceServers.length ? { iceTransportPolicy: "relay" } : {})
            })
            connections.push(this)
        }
    }
    const sockets = Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        connected: true,
        handlers: new Map<string, Function>(),
        on(name: string, fn: Function) {
            this.handlers.set(name, fn)
        },
        off(name: string) {
            this.handlers.delete(name)
        },
        emit(name: string, payload: any) {
            const target = sockets[payload.targetUserId - 1]
            if (target)
                setTimeout(() =>
                    target.handlers.get(name)?.({
                        ...payload,
                        fromUserId: index + 1,
                        fromUsername: "peer-" + (index + 1)
                    })
                )
        }
    }))
    const meshes = sockets.map(
        (socket) =>
            new VoiceMesh({
                socket: socket as any,
                roomId: 456,
                context: "party",
                myUserId: socket.id,
                iceServers: Array.isArray(iceServers) ? iceServers : iceServers[socket.id]
            })
    )
    const expected = count * (count - 1),
        started = performance.now()
    try {
        await Promise.all(
            meshes.map((mesh, index) =>
                mesh.connectPartyPeers(
                    sockets.filter((_, i) => i !== index).map((s) => ({ userId: s.id, username: "peer-" + s.id }))
                )
            )
        )
        let connected = false
        for (let i = 0; i < 600; i++) {
            if (connections.length === expected && connections.every((pc) => pc.connectionState === "connected")) {
                connected = true
                break
            }
            await wait(50)
        }
        if (!connected)
            throw new Error(
                JSON.stringify({
                    expected,
                    actual: connections.length,
                    connected: connections.filter((pc) => pc.connectionState === "connected").length,
                    pairs: meshes.flatMap((mesh, index) =>
                        [...(mesh as any).peers].map(([peer, state]: any) => ({
                            user: index + 1,
                            peer,
                            state: state.pc.connectionState,
                            local: state.pc.localDescription?.sdp.match(/a=ice-ufrag:([^\r\n]+)/)?.[1],
                            remote: state.pc.remoteDescription?.sdp.match(/a=ice-ufrag:([^\r\n]+)/)?.[1]
                        }))
                    ),
                    states: connections.slice(0, 4).map((pc) => ({
                        state: pc.connectionState,
                        ice: pc.iceConnectionState,
                        signaling: pc.signalingState,
                        candidates: pc.localDescription?.sdp.match(/a=candidate:[^\n]+/g)?.length
                    }))
                })
            )
        const connectMs = Math.round(performance.now() - started),
            samples: any[] = []
        let lagTotal = 0,
            lagMax = 0,
            lagSamples = 0,
            last = performance.now()
        const timer = setInterval(() => {
            const now = performance.now(),
                lag = Math.max(0, now - last - 50)
            lagTotal += lag
            lagMax = Math.max(lagMax, lag)
            lagSamples++
            last = now
        }, 50)
        const collect = async () => {
            let sent = 0,
                received = 0,
                packets = 0,
                lost = 0,
                receivedStreams = 0,
                relayed = 0
            for (const pc of connections) {
                const stats = await pc.getStats()
                stats.forEach((s: any) => {
                    if (s.type === "outbound-rtp" && s.kind === "audio") sent += Number(s.bytesSent || 0)
                    if (s.type === "inbound-rtp" && s.kind === "audio") {
                        received += Number(s.bytesReceived || 0)
                        packets += Number(s.packetsReceived || 0)
                        lost += Math.max(0, Number(s.packetsLost || 0))
                        if (s.packetsReceived > 0) receivedStreams++
                    }
                    if (s.type === "transport" && s.selectedCandidatePairId) {
                        const pair = stats.get(s.selectedCandidatePairId)
                        if (pair && (stats.get(pair.localCandidateId)?.candidateType === "relay" || stats.get(pair.remoteCandidateId)?.candidateType === "relay")) relayed++
                    }
                })
            }
            return { at: performance.now(), sent, received, packets, lost, receivedStreams, relayed }
        }
        const before = await collect()
        await wait(5000)
        const after = await collect()
        clearInterval(timer)
        if (after.receivedStreams !== expected)
            throw new Error("Missing incoming audio streams: " + after.receivedStreams + "/" + expected)
        const elapsed = (after.at - before.at) / 1000
        return {
            participants: count,
            pairLinks: expected / 2,
            peerConnections: connections.length,
            incomingAudioStreams: after.receivedStreams,
            connectMs,
            aggregateSentKbps: Math.round(((after.sent - before.sent) * 8) / elapsed / 1000),
            aggregateReceivedKbps: Math.round(((after.received - before.received) * 8) / elapsed / 1000),
            lostPercent: +((100 * after.lost) / Math.max(1, after.packets + after.lost)).toFixed(3),
            eventLoopMeanLagMs: +(lagTotal / lagSamples).toFixed(2),
            eventLoopMaxLagMs: +lagMax.toFixed(2),
            relayConnections: after.relayed
        }
    } finally {
        await Promise.all(meshes.map((m) => m.destroy()))
        source.stop()
        destination.stream.getTracks().forEach((t) => t.stop())
        await audio.close()
        w.RTCPeerConnection = Original
    }
}
