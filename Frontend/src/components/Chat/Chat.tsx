import styles from "./Chat.module.css"
import { useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { FaPhone, FaUser, FaAngleDoubleRight } from "react-icons/fa"
import { IconContext } from "react-icons"
import { UserProps } from "../../types"
import { useSocket } from "../../server/SocketContext"

type MessageType = { 
    id: number, 
    sender_username: string, 
    receiver_username: string, 
    content: string, 
    created_at: string, 
    read: boolean,
    me: boolean 
}

type DisplayMessage = {
    me: boolean
    text: string
    data: number
}

type StartCallResponse = {
    success?: boolean
    roomId?: string
    err?: string
}

export default function Chat({ name }: UserProps) {
    const navigate = useNavigate()
    const [input, setInput] = useState("")
    const [chatMessages, setChatMessages] = useState<DisplayMessage[]>([])
    const [startCallError, setStartCallError] = useState<string | null>(null)
    const { socket } = useSocket()

    useEffect(() => {
        setChatMessages([])
        setStartCallError(null)
        if (!socket) return
        socket.emit("message:getMessages", { username: name })

        const handleGetMessages = (data: MessageType[]) => {
            setChatMessages(data.map(m => ({
                me: m.me,
                text: m.content,
                data: new Date(m.created_at).getTime()
            })))
        }

        const handleReceiveMessage = (msg: MessageType) => {
            if (msg.sender_username !== name && msg.receiver_username !== name) return
            setChatMessages(prev => [...prev, { me: false, text: msg.content, data: new Date(msg.created_at).getTime() }])
        }

        const handleSendMessage = (msg: MessageType) => {
            if (msg.receiver_username !== name && msg.sender_username !== name) return
            setChatMessages(prev => [...prev, { me: true, text: msg.content, data: new Date(msg.created_at).getTime() }])
        }

        socket.on("message:getMessages:success", handleGetMessages)
        socket.on("message:receive", handleReceiveMessage)
        socket.on("message:send:success", handleSendMessage)

        return () => {
            socket.off("message:getMessages:success", handleGetMessages)
            socket.off("message:receive", handleReceiveMessage)
            socket.off("message:send:success", handleSendMessage)
        }
    }, [socket, name])

    function onSend() {
        if (!input.trim() || !socket) return
        socket.emit("message:send", { username: name, message: input })
        setInput("")
    }

    const startCall = () => {
        if (!name || !socket || name === "Выберите пользователя") return

        socket.emit("call:start", { username: name }, (res: StartCallResponse) => {
            if (res?.success && res.roomId) {
                navigate("/talk", { state: { name, roomId: res.roomId } })
                setStartCallError(null)
            } else {
                setStartCallError(res?.err || "Unknown error")
                console.error(res?.err || "Unknown error")
            }
        })
    }

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp)
        return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`
    }

    return (
        <div className={styles.body}>
            <div className={styles.userInfo}>
                <span>{name}</span>
                <div className={styles.userButtons}>
                    {startCallError ? ( <span className={styles.callError}>{startCallError}</span> ) : null}
                    <IconContext.Provider value={{ size: "3.5vw" }}>
                        <div className={styles.iconButton} onClick={startCall}>
                            <FaPhone />
                        </div>
                    </IconContext.Provider>
                    <IconContext.Provider value={{ size: "3.5vw" }}>
                        <div className={styles.iconButton}>
                            <FaUser />
                        </div>
                    </IconContext.Provider>
                </div>
            </div>
            <div className={styles.horizontalDivider}></div>
            <div className={styles.chat}>
                <img src="./assets/chatBackground.png" alt="background" className={styles.chatBackground} />
                <div className={styles.messages}>
                    {chatMessages.slice().reverse().map(m => (
                        <div key={m.data} className={[m.me ? styles.myMessage : styles.otherMessage, styles.message].join(" ")}>
                            {m.text}
                            <span className={styles.data}>{formatTime(m.data)}</span>
                        </div>
                    ))}
                </div>
                <div className={styles.inputBody}>
                    <input onKeyDown={(e: any) => {
                        if (e.key === "Enter") onSend()
                    }} className={styles.input} placeholder="Введите сообщение..." value={input} onChange={e => setInput(e.target.value)} />
                    <button className={styles.sendButton} onClick={onSend}><FaAngleDoubleRight /></button>
                </div>
            </div>
        </div>
    )
}