import { useEffect, useRef, useState } from "react"
import { io, type Socket } from "socket.io-client"
import { SOCKET_URL, SOCKET_PATH } from "../../config"
import { accessSessionKey } from "../../utils/api/refreshSession"
import { createCallEndpointId } from "../../features/call/endpoint"

export function useSocketConnection(token: string | null) {
    const [callEndpointId] = useState(createCallEndpointId)
    const [connection, setConnection] = useState<{ identity: string; socket: Socket } | null>(null)
    const tokenRef = useRef<string | null>(token)
    tokenRef.current = token

    const identity = token ? (accessSessionKey(token) ?? token) : null
    const socket = connection?.identity === identity ? connection.socket : null

    useEffect(() => {
        if (!socket || !token) return
        if (socket.connected) socket.emit("auth:refresh", { token, peerIdentityProtocol: 1 })
        else socket.connect()
    }, [socket, token])

    useEffect(() => {
        if (!identity) {
            setConnection(null)
            return
        }

        const s = io(SOCKET_URL, {
            path: SOCKET_PATH,
            autoConnect: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 2000,
            reconnectionDelayMax: 15000,
            auth: (cb) => {
                const current = tokenRef.current
                const currentIdentity = current ? (accessSessionKey(current) ?? current) : null
                cb({
                    token: currentIdentity === identity ? (current ?? "") : "",
                    callProtocol: 3,
                    callEndpointId,
                    peerIdentityProtocol: 1
                })
            }
        })
        s.on("connect", () => console.log("Socket connected"))
        s.on("disconnect", (reason) => console.log("Socket disconnected:", reason))
        s.on("reconnect_attempt", (attempt) => console.log("Reconnect attempt:", attempt))
        setConnection({ identity, socket: s })
        return () => {
            s.disconnect()
        }
    }, [identity, callEndpointId])

    return socket
}
