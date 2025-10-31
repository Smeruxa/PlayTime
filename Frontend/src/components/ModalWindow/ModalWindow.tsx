import styles from "./ModalWindow.module.css"
import { Dispatch, SetStateAction, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useSocket } from "../../server/SocketContext"
import { CallIncomingType } from "../../utils/IncomingCallHandler"

interface ModalWindowProps {
    text: string
    call: CallIncomingType
    setShow: Dispatch<SetStateAction<CallIncomingType | null>>
}

export default function ModalWindow({ text, call, setShow }: ModalWindowProps) {
    const navigate = useNavigate()
    const { socket, setActiveCall, myName } = useSocket()
    const callRef = useRef<HTMLAudioElement | null>(null)
    const confirmedRef = useRef<HTMLAudioElement | null>(null)
    const declinedRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        if (callRef?.current) {
            if (call) {
                callRef.current.loop = true
                callRef.current.play()
            }
            else {
                const audio = callRef?.current
                if (audio) {
                    audio.pause()
                    audio.currentTime = 0
                    audio.loop = false
                }
            }
        }
    }, [call])

    const confirm = () => {
        if (!socket) return
        setShow(null)
        socket.emit("call:confirm", { roomId: call.roomId, accept: true })
        const audio = confirmedRef.current
        if (!audio) return
        audio.play().then(() => {
            const content = {
                names: [call.from, myName],
                roomId: call.roomId,
                incoming: true
            }
            setActiveCall(content)
            navigate("/content", { state: { name: call.from } })
        })
    }

    const reject = () => {
        if (!socket) return
        setShow(null)
        const audio = declinedRef.current
        if (audio) {
            audio.play().then(() => {
                socket.emit("call:confirm", { roomId: call.roomId, accept: false })
            })
        }
    }

    return (
        <div className={styles.body}>
            <audio ref={callRef} src="./assets/sounds/call.mp3" preload="auto" />
            <audio ref={confirmedRef} src="./assets/sounds/confirmed.mp3" preload="auto" />
            <audio ref={declinedRef} src="./assets/sounds/declined.mp3" preload="auto" />
            <div className={styles.modal}>
                <div className={styles.nameWrapper}>
                    <div className={styles.avatar}></div>
                    <span>{call.from}</span>
                </div>
                <span className={styles.quiteText}>{text}</span>
                <div className={styles.buttonWrapper}>
                    <button className={styles.button} style={{ backgroundColor: "#67e467ff" }} onClick={confirm}>Принять</button>
                    <button className={styles.button} style={{ backgroundColor: "#cf2121ff" }} onClick={reject}>Отклонить</button>
                </div>
            </div>
        </div>
    )
}