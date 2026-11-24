import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { io } from "socket.io-client"
import { SessionContext, socketContextDefaultValue } from "../../apps/frontend/src/server/socketContext/context"
import Talk from "../../apps/frontend/src/pages/Talk/Remake/Talk"
import { useVoiceRecorder } from "../../apps/frontend/src/features/chat/hooks/useVoiceRecorder"
import { setParticipantVolume } from "../../apps/frontend/src/conversation/participantVolume"
import { Button } from "../../apps/frontend/src/ui"
import ScreenShareModal from "../../apps/frontend/src/pages/Talk/Remake/ScreenShareModal"
import { captureScreenShare } from "../../apps/frontend/src/webrtc/screenCapture"
import "../../apps/frontend/src/index.css"

const userId = Number(new URLSearchParams(location.search).get("user"))
const username = userId === 1 ? "alex" : "mira"
const socket = io(location.origin, { path: "/qa-media-socket", auth: { userId }, transports: ["websocket"] })
const qa = window as unknown as { mediaQa: { socket: typeof socket; setParticipantVolume: typeof setParticipantVolume; attemptCapture: (sourceId?: string) => Promise<string | null>; recording?: () => Promise<unknown> } }
qa.mediaQa = { socket, setParticipantVolume, attemptCapture: async sourceId => {
    try { const stream = await captureScreenShare(false, sourceId); stream.getTracks().forEach(track => track.stop()); return null }
    catch (error) { return error instanceof Error ? error.message : String(error) }
} }

function Peer() {
    const [connected, setConnected] = useState(socket.connected)
    const [active, setActive] = useState(false)
    const [testScreenModal, setTestScreenModal] = useState(false)
    const recorder = useVoiceRecorder(8)
    useEffect(() => {
        const connect = () => setConnected(true), disconnect = () => setConnected(false)
        socket.on("connect", connect); socket.on("disconnect", disconnect)
        return () => { socket.off("connect", connect); socket.off("disconnect", disconnect) }
    }, [])
    useEffect(() => {
        qa.mediaQa.recording = async () => {
            if (!recorder.previewBlob) return null
            const context = new AudioContext()
            try {
                const decoded = await context.decodeAudioData(await recorder.previewBlob.arrayBuffer())
                const channel = decoded.getChannelData(0)
                const energy = channel.reduce((sum, sample) => sum + sample * sample, 0) / channel.length
                return { bytes: recorder.previewBlob.size, type: recorder.previewBlob.type, duration: decoded.duration, rms: Math.sqrt(energy) }
            } finally { await context.close() }
        }
    }, [recorder.previewBlob])
    return <MemoryRouter>
        <SessionContext.Provider value={{ ...socketContextDefaultValue, socket, myName: username, myUserId: userId }}>
            <main style={{ width: "100%", minWidth: 0, maxWidth: 960, margin: "24px auto", padding: 16 }}>
                <h1 style={{ fontSize: 24 }}>PlayTime · {username}</h1>
                <p style={{ color: "#9ba8b7", marginBottom: 20 }}>Изолированная проверка настоящего WebRTC · {connected ? "Сигнализация подключена" : "Подключение…"}</p>
                {active ? <Talk call={{ roomId: "1:2", names: ["alex", "mira"], incoming: userId === 2, confirmed: true }} setShow={() => setActive(false)} />
                    : <Button disabled={!connected} onClick={() => setActive(true)}>Подключиться к звонку</Button>}
                {userId === 2 ? <Button onClick={() => setTestScreenModal(true)} style={{ marginTop: 16 }}>Проверить ограничение демонстрации</Button> : null}
                {testScreenModal ? <ScreenShareModal onSelect={stream => stream.getTracks().forEach(track => track.stop())} onClose={() => setTestScreenModal(false)} /> : null}
                <section style={{ marginTop: 28, padding: 20, border: "1px solid #344152", borderRadius: 16 }}>
                    <h2 style={{ fontSize: 18 }}>Голосовое сообщение</h2>
                    <p role="status">{recorder.phase === "recording" ? "Идёт запись" : recorder.phase === "preview" ? "Запись готова" : "Готово к записи"}</p>
                    {recorder.phase === "idle" ? <Button onClick={() => void recorder.startRecording()}>Записать голосовое</Button> : null}
                    {recorder.phase === "recording" ? <Button onClick={recorder.stopRecording}>Остановить запись</Button> : null}
                    {recorder.previewUrl ? <audio controls src={recorder.previewUrl} style={{ display: "block", width: "100%", marginTop: 12 }} /> : null}
                    {recorder.phase === "preview" ? <Button onClick={recorder.cancelPreview}>Удалить запись</Button> : null}
                    {recorder.error ? <p role="alert">{recorder.error}</p> : null}
                </section>
            </main>
        </SessionContext.Provider>
    </MemoryRouter>
}
createRoot(document.getElementById("root")!).render(<Peer />)
