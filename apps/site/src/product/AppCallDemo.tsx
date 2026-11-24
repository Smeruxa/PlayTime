import { useEffect, useRef, useState } from "react"
import PartyCallSection from "../../../frontend/src/pages/Talk/Remake/components/PartyCallSection"
import DirectCallParticipants from "../../../frontend/src/pages/Talk/Remake/components/DirectCallParticipants"
import TalkScreenSharePanel from "../../../frontend/src/pages/Talk/Remake/components/TalkScreenSharePanel"
import CallControls from "../../../frontend/src/components/CallControls/CallControls"
import panel from "../../../frontend/src/features/call/CallPanel.module.css"
import talk from "../../../frontend/src/pages/Talk/Remake/Talk.module.css"

function drawDocument(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    canvas.width = 1280
    canvas.height = 720
    ctx.fillStyle = "#edf0f4"
    ctx.fillRect(0, 0, 1280, 720)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, 1280, 65)
    ctx.fillStyle = "#657283"
    ctx.font = "18px system-ui"
    ctx.fillText("Документы / План встречи", 38, 41)
    ctx.fillStyle = "#fff"
    ctx.shadowColor = "#18263b15"
    ctx.shadowBlur = 24
    ctx.fillRect(230, 100, 820, 580)
    ctx.shadowBlur = 0
    ctx.fillStyle = "#172334"
    ctx.font = "bold 42px system-ui"
    ctx.fillText("План встречи", 294, 185)
    ctx.fillStyle = "#758193"
    ctx.font = "20px system-ui"
    ctx.fillText("Команда · Обсуждение нового проекта", 294, 228)
    const tasks = ["Обсудить макет", "Распределить задачи", "Согласовать сроки"]
    tasks.forEach((text, index) => {
        const y = 306 + index * 88
        ctx.strokeStyle = "#d7e0e9"
        ctx.lineWidth = 2
        ctx.strokeRect(294, y - 21, 24, 24)
        ctx.fillStyle = "#26354a"
        ctx.font = "24px system-ui"
        ctx.fillText(text, 340, y)
        ctx.fillStyle = "#edf1f5"
        ctx.fillRect(340, y + 19, 360 - index * 45, 5)
    })
    ctx.fillStyle = "#8995a4"
    ctx.font = "16px system-ui"
    ctx.fillText("Пример документа для демонстрации", 294, 617)
}

export default function AppCallDemo({
    sharing,
    room,
    selected,
    mic,
    toggleMic,
    toggleScreen,
    end
}: {
    sharing: boolean
    room: boolean
    selected: string
    mic: boolean
    toggleMic: () => void
    toggleScreen: () => void
    end: () => void
}) {
    const [volume, setVolume] = useState(100)
    const [screenMuted, setScreenMuted] = useState(false)
    const [screenVolume, setScreenVolume] = useState(100)
    const [screen, setScreen] = useState<MediaStream | null>(null)
    const container = useRef<HTMLDivElement>(null)
    const media = useRef<HTMLVideoElement>(null)
    const presenter = room ? "Даня" : selected
    useEffect(() => {
        if (!sharing) return
        const canvas = document.createElement("canvas")
        drawDocument(canvas)
        const stream = canvas.captureStream(1)
        const frame = window.requestAnimationFrame(() => {
            drawDocument(canvas)
            setScreen(stream)
        })
        return () => {
            window.cancelAnimationFrame(frame)
            stream.getTracks().forEach((track) => track.stop())
        }
    }, [sharing])

    return (
        <div className={`${panel.shell} ${talk.body} app-demo-real-call`}>
            <TalkScreenSharePanel
                screenSources={sharing && screen ? [presenter] : []}
                effectiveSelected={presenter}
                hasMultipleScreens={false}
                localStream={null}
                remoteScreens={screen ? { [presenter]: screen } : {}}
                screenShareMuted={screenMuted}
                screenVolume={screenVolume}
                setScreenVolume={setScreenVolume}
                setScreenShareMuted={setScreenMuted}
                setSelectedScreenKey={() => {}}
                containerRef={container}
                mediaRef={media}
                onRequestFullscreen={() => {
                    if (document.fullscreenElement) return document.exitFullscreen()
                    return container.current?.requestFullscreen()
                }}
            />
            {room ? (
                <PartyCallSection
                    roomTitle={selected}
                    myName="Саша"
                    participants={[
                        { userId: 1, username: "Маша" },
                        { userId: 2, username: "Даня" },
                        { userId: 3, username: "Саша" }
                    ]}
                    valueSound={volume}
                    setValueSound={setVolume}
                    avatarByUsername={{}}
                    stageReady
                />
            ) : (
                <DirectCallParticipants
                    names={[selected, "Саша"]}
                    myName="Саша"
                    valueSound={volume}
                    setValueSound={setVolume}
                    avatarByUsername={{}}
                    stageReady
                />
            )}
            <div className={panel.controlsRow}>
                <CallControls
                    screenShareDisabled={false}
                    mic={mic}
                    toggleMic={toggleMic}
                    end={end}
                    onScreenShare={toggleScreen}
                    isSharingScreen={sharing}
                />
                <span className={panel.callState} aria-live="polite">
                    {!mic ? "Микрофон выключен" : room ? "В голосовом чате" : "Пользователь подключен"}
                </span>
            </div>
        </div>
    )
}
