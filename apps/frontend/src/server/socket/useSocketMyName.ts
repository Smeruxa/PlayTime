import { useEffect, useState } from "react"
import type { Socket } from "socket.io-client"
import { readJwtPayload } from "../../utils/jwtPayload"

type UserInfo = { username: string; userId: number }

export function useSocketMyName(socket: Socket | null, token: string | null) {
    const [myName, setMyName] = useState<string | null>(null)
    const [myUserId, setMyUserId] = useState<number | null>(null)

    useEffect(() => {
        if (!token) {
            setMyName(null)
            setMyUserId(null)
            return
        }
        const fromJwt = readJwtPayload(token)
        if (fromJwt?.username) setMyName(fromJwt.username)
        if (typeof fromJwt?.id === "number") setMyUserId(fromJwt.id)
    }, [token])

    useEffect(() => {
        if (!socket) {
            return
        }
        let cancelled = false

        const applyServer = (res: UserInfo | string) => {
            if (cancelled) return
            if (typeof res === "string") {
                setMyName(res)
                setMyUserId(null)
            } else if (res && typeof res === "object") {
                setMyName(res.username ?? null)
                setMyUserId(typeof res.userId === "number" ? res.userId : null)
            }
        }

        const requestUsername = () => {
            socket.emit("get:username", applyServer)
        }

        requestUsername()
        socket.on("connect", requestUsername)
        return () => {
            cancelled = true
            socket.off("connect", requestUsername)
        }
    }, [socket])

    return { myName, setMyName, myUserId, setMyUserId }
}
