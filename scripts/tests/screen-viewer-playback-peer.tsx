import { createRoot } from "react-dom/client"
import { useRef, useState } from "react"
import TalkScreenSharePanel from "../../apps/frontend/src/pages/Talk/Remake/components/TalkScreenSharePanel"
import { useScreenViewerMixer } from "../../apps/frontend/src/pages/Talk/Remake/hooks/useScreenViewerMixer"
import { toggleScreenViewerFullscreen } from "../../apps/frontend/src/pages/Talk/Remake/screenViewerFullscreen"

const qa = window as typeof window & {
    viewerQA?: {
        snapshot: () => unknown
        measure: () => Promise<number>
        reconnect: () => void
        voice: (enabled: boolean) => Promise<void>
    }
}
const context = new AudioContext()
const canvas = document.createElement("canvas")
canvas.width = 1280
canvas.height = 720
const draw = () => {
    const painter = canvas.getContext("2d")!
    painter.fillStyle = "#121c2a"
    painter.fillRect(0, 0, canvas.width, canvas.height)
    painter.fillStyle = "#e1efff"
    painter.font = "32px sans-serif"
    painter.fillText("PlayTime · Screen viewer", 70, 100)
    painter.fillStyle = "#24466b"
    painter.fillRect(70, 150, 1140, 450)
}
draw()
setInterval(draw, 100)
function source() {
    const destination = context.createMediaStreamDestination()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    gain.gain.value = 0.2
    oscillator.connect(gain).connect(destination)
    oscillator.start()
    return new MediaStream([...canvas.captureStream(10).getVideoTracks(), ...destination.stream.getAudioTracks()])
}
const voiceDestination = context.createMediaStreamDestination()
const voiceTone = context.createOscillator()
voiceTone.frequency.value = 880
voiceTone.connect(voiceDestination)
voiceTone.start()
const voice = new Audio()
voice.srcObject = voiceDestination.stream
voice.volume = 0.12
document.body.append(voice)
let analyser: AnalyserNode | null = null

function Viewer() {
    const [sources, setSources] = useState(() => ({ Alpha: source(), Beta: source() }))
    const [selected, setSelected] = useState("Alpha")
    const [muted, setMuted] = useState(false)
    const container = useRef<HTMLDivElement>(null)
    const media = useRef<HTMLVideoElement>(null)
    const { screenVolume, screenRestoreVolume, setScreenVolume } = useScreenViewerMixer({
        screenKey: selected,
        screenLabel: selected,
        screenAvailable: true,
        screenMuted: muted,
        setScreenMuted: setMuted
    })
    qa.viewerQA = {
        snapshot: () => {
            const video = container.current?.querySelector("video")
            const audio = container.current?.querySelector("audio")
            return {
                fullscreenContainer: document.fullscreenElement === container.current,
                videoAudioTracks: (video?.srcObject as MediaStream | null)?.getAudioTracks().length,
                audioAttached: !!audio?.srcObject,
                audioVolume: audio?.volume,
                audioMuted: audio?.muted,
                videoControls: video?.controls,
                sourceEnabled: sources[selected as keyof typeof sources].getTracks().every((track) => track.enabled),
                voiceVolume: voice.volume
            }
        },
        measure: async () => {
            if (!analyser) throw new Error("Tab output capture is not ready")
            await new Promise((resolve) => setTimeout(resolve, 450))
            const samples = new Float32Array(analyser.fftSize)
            let power = 0
            for (let i = 0; i < 8; i++) {
                analyser.getFloatTimeDomainData(samples)
                power += samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length
                await new Promise((resolve) => setTimeout(resolve, 25))
            }
            return Math.sqrt(power / 8)
        },
        reconnect: () => setSources((previous) => ({ ...previous, [selected]: source() })),
        voice: async (enabled) => {
            if (enabled) await voice.play()
            else voice.pause()
        }
    }
    return (
        <>
            <button
                onClick={async () => {
                    await context.resume()
                    const capture = await navigator.mediaDevices.getDisplayMedia({
                        video: true,
                        audio: true,
                        preferCurrentTab: true
                    } as DisplayMediaStreamOptions)
                    if (capture.getAudioTracks().length !== 1) throw new Error("Tab audio was not captured")
                    analyser = context.createAnalyser()
                    analyser.fftSize = 4096
                    context.createMediaStreamSource(capture).connect(analyser)
                    document.body.dataset.captureReady = "true"
                }}
            >
                Capture rendered audio
            </button>
            <TalkScreenSharePanel
                screenSources={Object.keys(sources)}
                effectiveSelected={selected}
                hasMultipleScreens
                localStream={null}
                remoteScreens={sources}
                screenShareMuted={muted}
                screenVolume={screenVolume}
                setScreenVolume={setScreenVolume}
                setScreenShareMuted={(update) => {
                    const next = typeof update === "function" ? update(muted) : update
                    if (!next && screenVolume === 0) setScreenVolume(screenRestoreVolume)
                    setMuted(next)
                }}
                setSelectedScreenKey={setSelected}
                containerRef={container}
                mediaRef={media}
                onRequestFullscreen={() => toggleScreenViewerFullscreen(container.current)}
            />
        </>
    )
}
createRoot(document.getElementById("root")!).render(<Viewer />)
