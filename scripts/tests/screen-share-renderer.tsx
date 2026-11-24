import React from "react"
import { createRoot } from "react-dom/client"
import { VoiceMesh } from "../../apps/frontend/src/webrtc/voiceMesh"
import { captureScreenShare } from "../../apps/frontend/src/webrtc/screenCapture"
import LocalScreenVideo from "../../apps/frontend/src/pages/Talk/Remake/components/LocalScreenVideo"

const w = window as any
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message)
}
async function until(check: () => unknown, message: string) {
    for (let i = 0; i < 120; i++) {
        if (check()) return
        await wait(50)
    }
    throw new Error(message)
}

w.runScreenShareTests = async () => {
    const checks: string[] = []
    const measurements: any[] = []
    const contexts: AudioContext[] = []
    const streams: MediaStream[] = []
    const meshes: VoiceMesh[] = []
    const roots = [createRoot(document.getElementById("screen-a")!), createRoot(document.getElementById("screen-b")!)]
    const timers: ReturnType<typeof setInterval>[] = []
    let capture: MediaStream | null = null
    try {
        localStorage.setItem("valueSound", "15")
        const context = new AudioContext()
        contexts.push(context)
        await context.resume()
        function tone(frequency: number): MediaStream {
            const oscillator = context.createOscillator()
            const gain = context.createGain()
            const out = context.createMediaStreamDestination()
            oscillator.frequency.value = frequency
            gain.gain.value = 0.08
            oscillator.connect(gain).connect(out)
            oscillator.start()
            streams.push(out.stream)
            return out.stream
        }
        function analyser(stream: MediaStream) {
            const node = context.createAnalyser()
            node.fftSize = 8192
            context.createMediaStreamSource(stream).connect(node)
            return {
                peak(frequency: number) {
                    const bins = new Float32Array(node.frequencyBinCount)
                    node.getFloatFrequencyData(bins)
                    const center = Math.round((frequency * node.fftSize) / context.sampleRate)
                    return Math.max(...bins.slice(center - 2, center + 3))
                },
                rms() {
                    const samples = new Float32Array(node.fftSize)
                    node.getFloatTimeDomainData(samples)
                    return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
                }
            }
        }
        let nativeProbe: ReturnType<typeof analyser> | null = null
        const ownTone = tone(707)
        const ownAudio = new Audio()
        ownAudio.srcObject = ownTone
        ownAudio.volume = 0.15
        await ownAudio.play()
        if (w.qa.systemAudio) {
            const source = await w.qa.source()
            assert(source, "No screen available for capture")
            capture = await captureScreenShare(true, source)
            streams.push(capture)
            const probe = analyser(new MediaStream(capture.getAudioTracks()))
            nativeProbe = probe
            await wait(1200)
            const external = probe.peak(303),
                own = probe.peak(707)
            measurements.push({ phase: "native-system-capture", external303dB: external, excludedOwn707dB: own })
            assert(external > -65, "System capture has no external audio samples")
            assert(own < external - 20, "PlayTime playback leaked into captured audio")
            checks.push("Native OS loopback captures another process and excludes PlayTime playback")
        }
        const microphones = [tone(505), tone(707)]
        let micIndex = 0
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
            configurable: true,
            value: async () => microphones[micIndex++]
        })
        const sockets = [1, 2].map((id) => ({
            id,
            connected: true,
            handlers: new Map<string, Function>(),
            on(name: string, fn: Function) {
                this.handlers.set(name, fn)
            },
            off(name: string) {
                this.handlers.delete(name)
            },
            emit(name: string, payload: any) {
                const target = sockets.find((socket) => socket.id !== id)!
                if (!this.connected || !target.connected) return
                queueMicrotask(() =>
                    target.handlers.get(name)?.({ ...payload, fromUserId: id, fromUsername: "peer-" + id })
                )
            }
        }))
        const connections: RTCPeerConnection[] = []
        const RealConnection = window.RTCPeerConnection
        w.RTCPeerConnection = class extends RealConnection {
            constructor(config: RTCConfiguration) {
                super(config)
                connections.push(this)
            }
        }
        for (let i = 0; i < 2; i++)
            meshes.push(
                new VoiceMesh({
                    socket: sockets[i] as any,
                    roomId: w.qa.direct ? "1:2" : 22,
                    context: w.qa.direct ? "direct" : "party",
                    directCallerId: w.qa.direct ? 1 : undefined,
                    myUserId: i + 1,
                    iceServers: []
                })
            )
        const remoteScreens: (MediaStream | null)[] = [null, null]
        meshes.forEach((mesh, index) =>
            mesh.onScreenShare(({ stream }) => {
                remoteScreens[index] = stream
                roots[index].render(stream ? <LocalScreenVideo stream={stream} className="screen-video" /> : null)
            })
        )
        if (w.qa.direct) {
            await meshes[0].start()
            await meshes[0].startDirectCall()
        } else {
            await meshes[0].connectPartyPeers([{ userId: 2, username: "peer-2" }])
        }
        await until(
            () => connections.length === 2 && connections.every((pc) => pc.connectionState === "connected"),
            "Voice peers did not connect"
        ).catch((error) => {
            measurements.push({
                phase: "connection-failure",
                micCaptures: micIndex,
                peers: connections.map((pc) => ({
                    signaling: pc.signalingState,
                    ice: pc.iceConnectionState,
                    state: pc.connectionState,
                    local: pc.localDescription?.type,
                    remote: pc.remoteDescription?.type
                }))
            })
            throw error
        })
        await until(() => document.querySelectorAll("body > audio").length === 2, "Missing voice playback elements")
        const voices = [...document.querySelectorAll<HTMLAudioElement>("body > audio")]
        const voiceProbes = voices.map((audio) => analyser(audio.srcObject as MediaStream))
        async function checkVoices(phase: string) {
            await wait(600)
            voices.forEach((audio, index) => {
                assert(
                    audio.isConnected && !audio.paused && audio.volume > 0 && !audio.muted,
                    phase + ": voice playback was muted/paused"
                )
                assert(voiceProbes[index].rms() > 0.005, phase + ": incoming voice has no samples")
            })
            measurements.push({ phase, voiceRms: voiceProbes.map((probe) => probe.rms()) })
            if (nativeProbe) {
                const external = nativeProbe.peak(303)
                const excluded = [505, 707, 1200].map((frequency) => nativeProbe!.peak(frequency))
                assert(external > -65, phase + ": external system audio stopped")
                assert(
                    excluded.every((peak) => peak < external - 20),
                    phase + ": call or screen playback leaked into capture"
                )
                measurements.push({
                    phase: phase + "-echo-exclusion",
                    external303dB: external,
                    excludedPlaybackDB: excluded
                })
            }
        }
        await checkVoices("before-screen")
        checks.push("Two-way voice has real received audio samples")
        function screenStream(frequency: number) {
            if (capture && frequency === 990) {
                const stream = capture.clone()
                streams.push(stream)
                return stream
            }
            const canvas = document.createElement("canvas")
            canvas.width = 320
            canvas.height = 180
            const ctx = canvas.getContext("2d")!
            let frame = 0
            timers.push(
                setInterval(() => {
                    ctx.fillStyle = ++frame % 2 ? "#123456" : "#345678"
                    ctx.fillRect(0, 0, 320, 180)
                }, 100)
            )
            ctx.fillRect(0, 0, 320, 180)
            const stream = new MediaStream([
                ...canvas.captureStream(10).getVideoTracks(),
                ...tone(frequency).getAudioTracks()
            ])
            streams.push(stream)
            return stream
        }
        async function checkScreen(index: number, frequency: number) {
            await until(
                () => remoteScreens[index]?.getAudioTracks().length && remoteScreens[index]?.getVideoTracks().length,
                "Remote screen lost video or system audio"
            )
            const stream = remoteScreens[index]!
            const probe = analyser(new MediaStream(stream.getAudioTracks()))
            await wait(650)
            const peak = probe.peak(frequency)
            measurements.push({ phase: "screen-received-" + index, frequency, peakDB: peak })
            assert(peak > -65, "Remote screen audio has no expected signal")
            const audio = document.getElementById(index === 0 ? "screen-a" : "screen-b")!.querySelector("audio")!
            assert(audio && !audio.paused && audio.srcObject, "Remote screen audio is not playing")
            const stats = await connections[index].getStats()
            assert(
                [...stats.values()].some(
                    (report: any) =>
                        report.type === "inbound-rtp" && report.kind === "video" && report.framesDecoded > 0
                ),
                "Remote screen video has no decoded frames"
            )
        }
        let first = screenStream(990)
        await meshes[0].setScreenShare(first)
        await checkScreen(1, capture ? 303 : 990)
        await checkVoices("during-screen")
        checks.push("Screen video and system sound arrive while both voices keep playing")
        roots[1].render(<LocalScreenVideo stream={remoteScreens[1]!} className="screen-video" muted />)
        await wait(150)
        assert(
            document.querySelector<HTMLAudioElement>("#screen-b audio")?.srcObject === null,
            "Screen mute did not stop only screen playback"
        )
        await checkVoices("screen-muted")
        roots[1].render(<LocalScreenVideo stream={remoteScreens[1]!} className="screen-video" />)
        await checkScreen(1, capture ? 303 : 990)
        checks.push("Muting/unmuting screen audio does not mute voice")
        const reverse = screenStream(1200)
        await meshes[1].setScreenShare(reverse)
        await checkScreen(0, 1200)
        await checkVoices("both-sharing")
        checks.push("Both participants can share with sound simultaneously")
        await meshes[0].setScreenShare(null)
        first.getTracks().forEach((track) => track.stop())
        await until(() => !remoteScreens[1], "Screen state did not clear on stop")
        await checkVoices("after-stop")
        first = screenStream(990)
        await meshes[0].setScreenShare(first)
        await checkScreen(1, capture ? 303 : 990)
        await checkVoices("after-restart")
        assert(
            connections.every((pc) => pc.getSenders().length === 3),
            "Restart accumulated extra RTP senders"
        )
        checks.push("Stopping/restarting preserves voice and resumes screen audio/video without extra senders")
        await Promise.all(meshes.map((mesh) => mesh.setScreenShare(null)))
        await until(() => remoteScreens.every((stream) => !stream), "Screens did not clear before simultaneous start")
        await Promise.all([meshes[0].setScreenShare(screenStream(990)), meshes[1].setScreenShare(screenStream(1200))])
        await checkScreen(1, capture ? 303 : 990)
        await checkScreen(0, 1200)
        await checkVoices("simultaneous-start")
        checks.push("Simultaneous screen-share offers preserve both screen sounds and both voices")
        const credentials = () => connections.map((pc) => pc.localDescription?.sdp.match(/a=ice-ufrag:([^\r\n]+)/)?.[1])
        const beforeReconnect = credentials()
        sockets[0].connected = false
        meshes[1].reconnect()
        await wait(200)
        sockets[0].connected = true
        meshes[0].reconnect()
        await until(
            () =>
                connections.every(
                    (pc, i) =>
                        pc.connectionState === "connected" &&
                        pc.signalingState === "stable" &&
                        credentials()[i] !== beforeReconnect[i]
                ),
            "ICE did not recover after lost signalling"
        )
        await checkVoices("after-network-reconnect")
        await checkScreen(1, capture ? 303 : 990)
        await checkScreen(0, 1200)
        assert(micIndex === 2 && connections.length === 2, "Reconnect replaced microphones or peer connections")
        checks.push("Lost signalling recovers with both voices and screens, preserving microphones and connections")
        const beforeSimultaneousReconnect = credentials()
        meshes[0].reconnect()
        meshes[1].reconnect()
        await until(
            () =>
                connections.every(
                    (pc, i) =>
                        pc.connectionState === "connected" &&
                        pc.signalingState === "stable" &&
                        credentials()[i] !== beforeSimultaneousReconnect[i]
                ),
            "Simultaneous ICE restart did not resolve the offer collision"
        )
        await checkVoices("after-simultaneous-ice-restart")
        checks.push("Simultaneous ICE restarts resolve offer collisions and keep two-way audio")
        ownAudio.pause()
        ownAudio.srcObject = null
        w.qa.report({ ok: true, checks, measurements })
    } catch (error) {
        w.qa.report({ ok: false, error: String(error), checks, measurements })
    } finally {
        timers.forEach(clearInterval)
        roots.forEach((root) => root.unmount())
        for (const mesh of meshes) await mesh.destroy()
        streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()))
        for (const context of contexts) await context.close()
    }
}
