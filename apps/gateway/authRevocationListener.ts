import { setTimeout as delay } from "node:timers/promises"
import { Client } from "pg"
import type { Server, Socket } from "socket.io"
import { pool } from "../shared/config"
import { authSessionChangeChannel } from "../shared/runtime/authContracts"
import { InternalHttpError } from "../shared/runtime/internalHttp"
import type { RoomTarget } from "../shared/socket/featureContext"
import { accessSessionRoom, deviceSessionRoom, type AccessTokenPayload } from "../shared/types/contracts/accessSession"

const migration = "036_auth_session_notifications.sql"
const devicePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const checkConcurrency = 12

type CheckSession = (session: AccessTokenPayload) => Promise<void>

function decodeRoom(payload: string | undefined): string | undefined {
    if (!payload || payload.length > 800) return
    try {
        const event: unknown = JSON.parse(payload)
        if (!Array.isArray(event) || event.length !== 2 || typeof event[1] !== "string") return
        const [scope, target] = event
        if (scope === "user" && /^[1-9][0-9]{0,9}$/.test(target) && Number(target) <= 2147483647) return target
        if (scope === "device" && devicePattern.test(target)) return deviceSessionRoom(target)
        if (scope === "access" && target.length > 0 && target.length <= 128) return accessSessionRoom(target)
    } catch {}
}

export function startAuthRevocationListener(io: Server, checkSession: CheckSession) {
    let stopped = false
    let listening = false
    let revision = 0
    let endConnection: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let checking = false
    const queued = new Set<Socket>()

    function disable(): void {
        if (!listening) return
        listening = false
        revision++
        queued.clear()
        clearTimeout(timer)
        timer = undefined
        if (!stopped) {
            for (const socket of io.sockets.sockets.values()) socket.conn.close()
        }
    }

    async function checkSocket(socket: Socket): Promise<void> {
        if (!socket.connected) return
        const session = socket.data.accessSession
        try {
            await checkSession(session)
        } catch (error) {
            if (!socket.connected || socket.data.accessSession !== session) return
            if (error instanceof InternalHttpError && error.status === 401) {
                socket.emit("session:revoked")
                socket.disconnect(true)
            } else {
                socket.conn.close()
            }
        }
    }

    async function checkQueue(): Promise<void> {
        timer = undefined
        checking = true
        try {
            while (listening && queued.size) {
                const batch = Array.from(queued).slice(0, checkConcurrency)
                for (const socket of batch) queued.delete(socket)
                await Promise.all(batch.map(checkSocket))
            }
        } finally {
            checking = false
        }
    }

    function recheck(rooms: RoomTarget): void {
        if (!listening) return
        for (const room of Array.isArray(rooms) ? rooms : [rooms]) {
            for (const id of io.sockets.adapter.rooms.get(room) ?? []) {
                const socket = io.sockets.sockets.get(id)
                if (socket) queued.add(socket)
            }
        }
        if (queued.size && !timer && !checking) timer = setTimeout(() => void checkQueue(), 125).unref()
    }

    function onChange(payload: string | undefined): void {
        if (!listening) return
        const room = decodeRoom(payload)
        if (!room) return
        revision++
        recheck(room)
    }

    async function run(): Promise<void> {
        while (!stopped) {
            const options = pool.options
            const client = new Client({
                ...options,
                password: options.password,
                application_name: "playtime-gateway-auth-watch",
                query_timeout: 3000,
                keepAlive: true,
                keepAliveInitialDelayMillis: 1000
            })
            let active = true
            let disconnect: () => void = () => {}
            const disconnected = new Promise<void>((resolve) => {
                disconnect = resolve
            })
            const finish = () => {
                if (!active) return
                active = false
                disable()
                disconnect()
            }
            endConnection = finish
            client.on("error", finish)
            client.once("end", finish)
            client.on("notification", (message) => {
                if (active && message.channel === authSessionChangeChannel) onChange(message.payload)
            })
            let heartbeat: ReturnType<typeof setInterval> | undefined
            try {
                await client.connect()
                const result = await client.query("SELECT 1 FROM public.schema_migrations WHERE version=$1", [
                    migration
                ])
                if (!result.rowCount) throw new Error("Missing authentication notification migration")
                await client.query(`LISTEN ${authSessionChangeChannel}`)
                if (!active || stopped) continue
                listening = true
                revision++
                let pending = false
                heartbeat = setInterval(() => {
                    if (pending || !active) return
                    pending = true
                    void client
                        .query("SELECT 1")
                        .catch(finish)
                        .finally(() => {
                            pending = false
                        })
                }, 3000).unref()
                await disconnected
            } catch {
                finish()
            } finally {
                clearInterval(heartbeat)
                await client.end().catch(() => undefined)
            }
            if (!stopped) await delay(500, undefined, { ref: false })
        }
    }

    void run()
    return {
        ready: () => listening,
        recheck,
        async verify<T extends { session: AccessTokenPayload }>(verifySession: () => Promise<T>): Promise<T> {
            if (!listening) throw new InternalHttpError(503)
            let seen = revision
            const result = await verifySession()
            for (let attempt = 0; listening && attempt < 3; attempt++) {
                if (seen === revision) return result
                seen = revision
                await checkSession(result.session)
            }
            throw new InternalHttpError(503)
        },
        close() {
            stopped = true
            endConnection?.()
        }
    }
}
