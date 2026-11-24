import { createRoot } from "react-dom/client"
import { useState } from "react"
import LocalScreenVideo from "../../apps/frontend/src/pages/Talk/Remake/components/LocalScreenVideo"
import { useScreenViewerMixer } from "../../apps/frontend/src/pages/Talk/Remake/hooks/useScreenViewerMixer"

const w = window as any
const context = new AudioContext()
const out = context.createMediaStreamDestination()
const oscillator = context.createOscillator()
oscillator.connect(out)
oscillator.start()
const voice = document.createElement("audio")
voice.srcObject = out.stream
voice.volume = 0.42
voice.autoplay = true
voice.id = "voice"
document.body.append(voice)
const track = out.stream.getAudioTracks()[0]
const initialId = track.id
const canvas = document.createElement("canvas")
canvas.width = 1280
canvas.height = 720
const painter = canvas.getContext("2d")!
painter.fillStyle = "#121c2a"
painter.fillRect(0, 0, 1280, 720)
painter.fillStyle = "#e1efff"
painter.font = "32px sans-serif"
painter.fillText("PlayTime · Electron screen viewer", 70, 100)
const demo = new MediaStream([...canvas.captureStream(10).getVideoTracks(), track])
setInterval(() => {
    painter.fillRect(70, 160, 1140, 2)
    window.electronAPI?.screenShareViewerSendFrame?.(canvas.toDataURL("image/jpeg"))
}, 100)
localStorage.setItem("valueSound", "83")
function Demo() {
    const [muted, setMuted] = useState(false)
    const { screenVolume } = useScreenViewerMixer({
        screenKey: "test-peer",
        screenLabel: "Звук демонстрации",
        screenAvailable: true,
        screenMuted: muted,
        setScreenMuted: setMuted
    })
    w.snapshot = () => ({
        demo: document.querySelector<HTMLAudioElement>("#demo audio")?.volume,
        demoPlaying: !!document.querySelector<HTMLAudioElement>("#demo audio")?.srcObject,
        demoMuted: document.querySelector<HTMLAudioElement>("#demo audio")?.muted,
        videoAudioTracks: (
            document.querySelector<HTMLVideoElement>("#demo video")?.srcObject as MediaStream | null
        )?.getAudioTracks().length,
        voice: voice.volume,
        master: localStorage.getItem("valueSound"),
        trackEnabled: track.enabled,
        trackUnchanged: track.id === initialId
    })
    return <LocalScreenVideo stream={demo} className="screen" muted={muted} volume={screenVolume} />
}
const root = createRoot(document.getElementById("demo")!)
root.render(<Demo />)
w.closeDemo = () => root.unmount()
