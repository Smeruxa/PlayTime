import React, { createContext, useContext } from "react"
import { useNavigate } from "react-router-dom"
import { useSocket } from "../../server/SocketContext"

interface AuthContextType {
    token: string | null
    setToken: (t: string | null) => void
    logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const navigate = useNavigate()
    const { token, setToken } = useSocket()

    const logout = () => {
        localStorage.removeItem("email")
        localStorage.removeItem("password")
        setToken(null)
        navigate("/")
    }

    return (
        <AuthContext.Provider value={{ token, setToken, logout }}>
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (!context) throw new Error("useAuth must be used within AuthProvider")
    return context
}