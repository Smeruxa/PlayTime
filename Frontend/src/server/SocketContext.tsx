import { createContext, useContext, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { io, Socket } from "socket.io-client"

type SocketContextType = {
    socket: Socket | null
    token: string | null
    setToken: (t: string | null) => void
    logout: () => void
}

const SocketContext = createContext<SocketContextType>({
    socket: null,
    token: null,
    setToken: () => {},
    logout: () => {}
})

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
    const [token, setToken] = useState<string | null>(null)
    const [socket, setSocket] = useState<Socket | null>(null)
    const navigate = useNavigate()

    useEffect(() => {
        if (!token) return
        const s = io("wss://smeruxa.ru", {
            path: "/playtime/socket.io",
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

    const logout = () => {
        localStorage.removeItem("email")
        localStorage.removeItem("password")
        setToken(null)
        navigate("/")
    }

    return (
        <SocketContext.Provider value={{ socket, token, setToken, logout }}>
            {children}
        </SocketContext.Provider>
    )
}

export const useSocket = () => useContext(SocketContext)