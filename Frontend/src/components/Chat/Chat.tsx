import styles from "./Chat.module.css"
import Talk from "../../pages/Talk/Remake/Talk"
import { useLocation, useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { FaPhone, FaUser, FaAngleDoubleRight } from "react-icons/fa"
import { IconContext } from "react-icons"
import { UserProps, MessageType, CallProps } from "../../types"
import { useSocket } from "../../server/SocketContext"

type DisplayMessage = {
    me: boolean
    text: string
    data: number
    from?: string
}

type StartCallResponse = {
    success?: boolean
    roomId?: string
    err?: string
}

interface ChatProps extends UserProps {
    incomingCall?: CallProps | null
    onEndCall?: () => void
}

export default function Chat({ name, is_room, id, incomingCall, onEndCall }: ChatProps) {
    const [input, setInput] = useState("")
    const [chatMessages, setChatMessages] = useState<DisplayMessage[]>([])
    const [startCallError, setStartCallError] = useState<string | null>(null)

    const [callData, setCallData] = useState<CallProps | null>(null)
    const [showCall, setShowCall] = useState(false)

    const { socket, myName } = useSocket()

    useEffect(() => {
        if (incomingCall) {
            setCallData(incomingCall)
            setShowCall(true)
        }
    }, [incomingCall])

    useEffect(() => {
        setChatMessages([])
        setStartCallError(null)
        if (!socket) return

        if (is_room)
            socket.emit("message:getMessages", { username: name, roomId: id })
        else
            socket.emit("message:getMessages", { username: name })

        const handleGetMessages = (data: any[]) => {
            setChatMessages(data.map(m => ({
                me: is_room ? m.sender_username === myName : m.me,
                text: m.content,
                data: new Date(m.created_at).getTime(),
                ...(is_room ? { from: m.sender_username } : {})
            })))
        }

        const handleReceiveMessage = (msg: any) => {
            if (is_room) {
                if (msg.roomId !== id) return
                setChatMessages(prev => [...prev, { me: msg.from === myName, text: msg.content, data: new Date().getTime(), from: msg.from }])
            } else {
                if (msg.sender_username !== name && msg.receiver_username !== name) return
                setChatMessages(prev => [
                    ...prev,
                    { me: msg.sender_username === myName, text: msg.content, data: new Date(msg.created_at).getTime() }
                ])
            }
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
        if (is_room) {
            setInput("")
            return socket.emit("message:send", { roomId: id, content: input })
        }
        socket.emit("message:send", { username: name, message: input })
        setInput("")
    }

    const startCall = () => {
        if (!name || !socket || name === "Выберите пользователя") return

        socket.emit("call:start", { username: name }, (res: StartCallResponse) => {
            if (res?.success && res.roomId) {
                setCallData({
                    names: [name, myName],
                    roomId: res.roomId,
                    incoming: false
                })
                setShowCall(true)
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
            {callData && showCall && (
                <Talk 
                    call={callData} 
                    setShow={() => {
                        setCallData(null)
                        setShowCall(false)
                        onEndCall?.()
                    }} 
                />
            )}
            <div className={styles.chat}>
                <img src="./assets/chatBackground.png" alt="background" className={styles.chatBackground} />
                <div className={styles.messages}>
                    {chatMessages.slice().reverse().map(m => (
                        <div key={m.data} className={[m.me ? styles.myMessage : styles.otherMessage, styles.message].join(" ")}>
                            <span className={styles.partyFrom}>{(is_room && m.from) ? m.from : null}</span>
                            <span className={styles.userMessage}>{m.text}</span>
                            <span className={styles.data}>{formatTime(m.data)}</span>
                        </div>
                    ))}
                </div>
                <div className={styles.inputBody}>
                    <input
                        onKeyDown={(e: any) => { if (e.key === "Enter") onSend() }}
                        className={styles.input}
                        placeholder="Введите сообщение..."
                        value={input}
                        onChange={e => setInput(e.target.value.slice(0, 120))}
                    />
                    <button className={styles.sendButton} onClick={onSend}><FaAngleDoubleRight /></button>
                </div>
            </div>
        </div>
    )
}