import type { Socket } from "socket.io"
import {
    accessSessionRoom,
    deviceSessionRoom,
    type AccessTokenPayload
} from "../../shared/types/contracts/accessSession"
import { validSocketToken } from "../../shared/runtime/authContracts"
import { InternalHttpError } from "../../shared/runtime/internalHttp"
import { installSocketBudget } from "../socketBudget"
import type { AuthedUser } from "../../shared/socket/featureContext"

const SESSION_CHECK_INTERVAL_MS = 1000

type SocketAuthBackend = {
    verify(token: string): Promise<{ session: AccessTokenPayload; user: AuthedUser }>
    check(session: AccessTokenPayload): Promise<void>
    refreshEndpoint(socket: Socket): Promise<void>
    reconnectOnUnavailable?: boolean
}

function isTemporaryAuthFailure(error: unknown): boolean {
    if (error instanceof InternalHttpError) return error.status >= 500
    if (error instanceof TypeError) return error.message === "fetch failed"
    return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
}

export function createSocketAuth(backend: SocketAuthBackend) {
    const shouldReconnect = (error: unknown) => backend.reconnectOnUnavailable && isTemporaryAuthFailure(error)
    return async (socket: Socket, next: (error?: Error) => void): Promise<void> => {
        const token = socket.handshake.auth?.token
        if (!validSocketToken(token)) return next(new Error("Authentication error"))
        try {
            const { session, user } = await backend.verify(token)
            socket.user = user
            socket.data.accessSession = session
            if (!installSocketBudget(socket, user.id)) return next(new Error("Слишком много подключённых устройств"))
            let currentSession = session
            let lastCheck = 0
            let checking: { session: AccessTokenPayload; promise: Promise<void> } | undefined
            let refreshing: Promise<void> | undefined
            const reject = (error: unknown) => {
                if (shouldReconnect(error)) socket.conn.close()
                else socket.disconnect(true)
            }
            const expire = () => {
                socket.emit("session:expired")
                socket.disconnect(true)
            }
            const startExpiry = (payload: AccessTokenPayload) =>
                setTimeout(expire, Math.max(0, payload.exp * 1000 - Date.now())).unref()
            let expiry = startExpiry(session)

            socket.on("auth:refresh", (data: unknown) => {
                const operation = (refreshing ?? Promise.resolve()).then(async () => {
                    if (!socket.connected) return
                    if (!data || typeof data !== "object" || !("token" in data) || !validSocketToken(data.token)) {
                        throw new Error("invalid token")
                    }
                    const { session } = await backend.verify(data.token)
                    if (session.id !== user.id) throw new Error("invalid user")
                    if (!socket.connected) return

                    const previous = currentSession
                    await socket.join(accessSessionRoom(session.jti))
                    if (session.sessionId) await socket.join(deviceSessionRoom(session.sessionId))
                    if (previous.jti !== session.jti) await socket.leave(accessSessionRoom(previous.jti))
                    if (previous.sessionId && previous.sessionId !== session.sessionId) {
                        await socket.leave(deviceSessionRoom(previous.sessionId))
                    }
                    if (!socket.connected) return
                    socket.data.accessSession = session
                    await backend.refreshEndpoint(socket)
                    await backend.check(session)
                    if (!socket.connected) return
                    currentSession = session
                    lastCheck = 0
                    clearTimeout(expiry)
                    expiry = startExpiry(session)
                })
                refreshing = operation
                const finish = () => {
                    if (refreshing === operation) refreshing = undefined
                }
                void operation.then(finish, (error) => {
                    finish()
                    reject(error)
                })
            })

            const checkCurrentSession = async (): Promise<void> => {
                if (refreshing) await refreshing
                const session = currentSession
                if (!refreshing && Date.now() - lastCheck < SESSION_CHECK_INTERVAL_MS) return
                if (checking?.session !== session) {
                    const promise = backend
                        .check(session)
                        .then(() => {
                            if (currentSession === session && !refreshing) lastCheck = Date.now()
                        })
                        .finally(() => {
                            if (checking?.promise === promise) checking = undefined
                        })
                    checking = { session, promise }
                }
                try {
                    await checking.promise
                } catch (error) {
                    if (currentSession === session && !refreshing) throw error
                }
                if (currentSession !== session || refreshing) await checkCurrentSession()
            }

            socket.use(([event], done) => {
                if (event === "auth:refresh") return done()
                void checkCurrentSession().then(
                    () => done(socket.connected ? undefined : new Error("Authentication error")),
                    (error) => {
                        done(new Error("Authentication error"))
                        reject(error)
                    }
                )
            })
            socket.once("disconnect", () => clearTimeout(expiry))
            next()
        } catch (error) {
            if (shouldReconnect(error)) socket.conn.close()
            next(new Error("Authentication error"))
        }
    }
}
