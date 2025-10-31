import styles from "./Talk.module.css"
import { useNavigate, useLocation } from "react-router-dom"
import { useState, useEffect, useRef } from "react"
import { useSocket } from "../../server/SocketContext"
import { initAudio, playAudio } from "../../conversation/conversation"
import ValuesEditors from "../../components/ValuesEditors/ValuesEditors"

export default function Talk() {
    const navigate = useNavigate()
    const location = useLocation()
    const { socket } = useSocket()
    const { name, roomId, incoming } = location.state || {}

    const [micState, setMicState] = useState(() => {
        const saved = localStorage.getItem("micState")
        return saved !== null ? JSON.parse(saved) : true
    })
    const [callState, setCallState] = useState<string>(!incoming ? "Создаем комнату и ожидаем пользователя.." : "Вы подключились, приятного разговора")
    const audioContextRef = useRef<AudioContext | null>(null)
    const mediaStreamRef = useRef<MediaStream | null>(null)
    const setMicStateRef = useRef<((state: boolean) => void) | null>(null)

    const callRef = useRef<HTMLAudioElement | null>(null)
    const confirmedRef = useRef<HTMLAudioElement | null>(null)
    const declinedRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        if (!socket || !roomId) return

        let audioContext: AudioContext | null = null
        let mediaStream: MediaStream | null = null
        let destroyed = false

        const clickHandler = () => {
            if (audioContext?.state === "suspended") audioContext.resume().catch(() => {})
        }
        document.addEventListener("click", clickHandler)

        const stopAll = async () => {
            destroyed = true
            document.removeEventListener("click", clickHandler)

            socket.off("call:confirmed", handleConfirmed)
            socket.off("call:rejected", handleRejectedOrEnded)
            socket.off("call:ended", handleRejectedOrEnded)
            socket.off("call:room:receive", handleVoice)

            if (mediaStream) {
                mediaStream.getTracks().forEach(t => {
                    t.stop()
                    mediaStream?.removeTrack(t)
                })
            }

            if (audioContext && audioContext.state !== "closed") {
                await audioContext.close().catch(() => {})
            }

            audioContext = null
            mediaStream = null
            audioContextRef.current = null
            mediaStreamRef.current = null
        }

        const stopCallRef = () => {
            const a = callRef?.current
            if (!a) return
            a.pause()
            a.currentTime = 0
            a.loop = false
        }

        const handleConfirmed = () => {
            if (destroyed) return
            stopCallRef()
            setCallState("Пользователь подключен, приятного разговора")
            confirmedRef.current?.play()
        }

        const handleRejectedOrEnded = () => {
            if (destroyed) return
            stopCallRef()
            declinedRef.current?.play().finally(() => {
                stopAll().then(() => navigate("/content"))
            })
        }

        const handleVoice = (payload: { voiceData: ArrayBuffer }) => {
            if (destroyed || !audioContext) return
            playAudio(audioContext, payload.voiceData)
        }

        const setupAudio = async () => {
            try {
                const result = await initAudio(socket, roomId)
                if (destroyed) {
                    result.mediaStream.getTracks().forEach(t => t.stop())
                    await result.audioContext.close().catch(() => {})
                    return
                }
                audioContext = result.audioContext
                mediaStream = result.mediaStream
                audioContextRef.current = audioContext
                mediaStreamRef.current = mediaStream
                setMicStateRef.current = result.setMicState
            } catch {}
        }

        setupAudio()

        if (!incoming && callRef?.current) {
            callRef.current.loop = true
            callRef.current.play()
        }

        socket.on("call:confirmed", handleConfirmed)
        socket.on("call:rejected", handleRejectedOrEnded)
        socket.on("call:ended", handleRejectedOrEnded)
        socket.on("call:room:receive", handleVoice)

        return () => {
            stopAll()
        }
        
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, roomId])

    const endCall = () => {
        if (!socket) return 

        socket.emit("call:end", { roomId: roomId })
        navigate("/content")
    }

    return (
        <div className={styles.body}>
            <audio ref={callRef} src="./assets/sounds/call.mp3" preload="auto" />
            <audio ref={confirmedRef} src="./assets/sounds/confirmed.mp3" preload="auto" />
            <audio ref={declinedRef} src="./assets/sounds/declined.mp3" preload="auto" />
            <div className={styles.call}>
                <span className={styles.username}>{name}</span>
                <span className={styles.status}>{callState}</span>
                <ValuesEditors />
                <div className={styles.buttonsWrapper}>
                    <button onClick={() => {
                        const newState = !micState
                        setMicState(newState)
                        localStorage.setItem("micState", JSON.stringify(newState))
                        setMicStateRef.current?.(newState)
                    }} className={styles.typicalButton}>
                        Mic {micState ? "On" : "Off"}
                    </button>
                    <button onClick={endCall} className={styles.typicalButton}>
                        Завершить
                    </button>
                </div>
            </div>
        </div>
    )
}