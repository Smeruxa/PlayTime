import styles from "./Talk.module.css"
import CallUser from "../../../components/CallUser/CallUser"
import CallControls from "../../../components/CallControls/CallControls"
import { useState, useEffect } from "react"
import { useSocket } from "../../../server/SocketContext"
import { useCallAudio } from "./hooks/useCallAudio"
import { CallProps } from "../../../types"

export default function Talk({ setShow, call }: { setShow: any, call: CallProps }) {
    const { socket } = useSocket()
    const { names, roomId, incoming } = call
    const [mic, setMic] = useState(() => JSON.parse(localStorage.getItem("micState") || "true"))
    const [callState, setCallState] = useState(!incoming ? "Вызываем пользователя..." : "Подключились")

    const [valueSound, setValueSound] = useState<number>(() => {
        const saved = localStorage.getItem("valueSound");
        return saved !== null ? Number(saved) : 0;
    });
    useEffect(() => localStorage.setItem("valueSound", valueSound.toString()), [valueSound]);

    const { audioRefs, setMicStateRef } = useCallAudio(socket, roomId, incoming, () => setShow(false), setCallState)

    const toggleMic = () => {
        const s = !mic
        setMic(s)
        localStorage.setItem("micState", JSON.stringify(s))
        setMicStateRef.current?.(s)
    }

    const end = async () => {
        setCallState("Отключено...");

        const callAudio = audioRefs.callRef.current
        if (callAudio && !callAudio.paused) {
            callAudio.pause()
            callAudio.currentTime = 0
        }
        const declined = audioRefs.declinedRef.current
        if (declined) {
            await declined.play()
            await new Promise(r => declined.onended = r)
        }
        socket?.emit("call:end", { roomId })
        setShow()
    }

    return (
        <>
            <audio ref={audioRefs.declinedRef} src="./assets/sounds/declined.mp3" preload="auto" />
            <audio ref={audioRefs.confirmedRef} src="./assets/sounds/confirmed.mp3" preload="auto" />
            <audio ref={audioRefs.callRef} src="./assets/sounds/call.mp3" preload="auto" />
            <div className={styles.body}>
                <div className={styles.names}>
                    {names.map(v => <CallUser key={v} name={v!} />)}
                    <input type="range" min={0} max={100} className={styles.verticalSlider} value={valueSound} onChange={(e) => setValueSound(Number(e.target.value))} />
                </div>
                <div className={styles.interactiveWrapper}>
                    <CallControls mic={mic} toggleMic={toggleMic} end={end} />
                    <span className={styles.state}>{callState}</span>
                </div>
                <div className={styles.horizontalDivider}></div>
            </div>
        </>
    )
}