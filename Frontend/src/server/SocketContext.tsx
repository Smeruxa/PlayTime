import { createContext, useContext, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { io, Socket } from "socket.io-client"
import { MessageType, CallProps } from "../types"

type SocketContextType = {
    socket: Socket | null
    token: string | null
    activeCall: CallProps | null,
    myName: string | null,
    setToken: (t: string | null) => void
    logout: () => void
    setActiveCall: (t: CallProps | null) => void
    setMyName: (t: string | null) => void
}

const SocketContext = createContext<SocketContextType>({
    socket: null,
    token: null,
    activeCall: null,
    myName: null,
    setToken: () => {},
    logout: () => {},
    setActiveCall: () => {},
    setMyName: () => {}
})

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
    const [token, setToken] = useState<string | null>(null)
    const [socket, setSocket] = useState<Socket | null>(null)
    const [activeCall, setActiveCall] = useState<CallProps | null>(null)
    const [myName, setMyName] = useState<string | null>(null)
    const navigate = useNavigate()
    
    useEffect(() => {
        if (!token) return
        const s = io("", {
            path: "",
            autoConnect: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 4000,
            auth: { token }
        })
        s.on("connect", () => console.log("Socket connected"))
        s.on("disconnect", reason => console.log("Socket disconnected:", reason))
        s.on("reconnect_attempt", attempt => console.log("Reconnect attempt:", attempt))
        setSocket(s)
        return () => { s.disconnect() }
    }, [token])

    useEffect(() => {
        if (!socket) return
        socket.emit("get:username", (username: string) => setMyName(username))
        const messageReceiveHandler = (msg: MessageType) => {
            if (window.electronAPI?.sendNotification)            
                window.electronAPI.sendNotification({ name: msg.sender_username, text: msg.content })
        }
        socket.on("message:receive", messageReceiveHandler)
        return () => {
            socket.off("message:receive", messageReceiveHandler)
        }
    }, [socket])

    const logout = () => {
        localStorage.removeItem("email")
        localStorage.removeItem("password")
        setToken(null)
        navigate("/")
    }

    return (
        <SocketContext.Provider value={{ socket, token, activeCall, myName, setToken, logout, setActiveCall, setMyName }}>
            {children}
        </SocketContext.Provider>
    )
}

export const useSocket = () => useContext(SocketContext)