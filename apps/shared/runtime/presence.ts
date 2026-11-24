import type { FeatureContext, FeatureIo } from "../socket/featureContext"
import { socketAck } from "../types/socket/ack"

type Presence = { username: string; sockets: Set<string>; offlineTimer?: ReturnType<typeof setTimeout> }
type PresenceSource = {
    friends(id: number): Promise<{ id: number; username: string }[]>
    audience(recipientId: number, participantIds: number[]): Promise<string>
    online?(io: FeatureIo, ids: number[]): Promise<Set<number>>
}

export type PresenceDelegate = (event: "presence:list" | "presence:listByUserId", callback: unknown) => boolean

export function createPresence(initialSource?: PresenceSource) {
    const online = new Map<number, Presence>()
    const friendCache = new Map<number, { until: number; rows: { id: number; username: string }[] }>()
    const offlineTimers = new Map<number, ReturnType<typeof setTimeout>>()
    let presenceSource = initialSource

    function setPresenceSource(source: PresenceSource): void {
        presenceSource = source
        friendCache.clear()
    }
    async function friends(id: number) {
        if (presenceSource?.online) return presenceSource.friends(id)
        const cached = friendCache.get(id)
        if (cached && cached.until > Date.now()) return cached.rows
        const rows = presenceSource ? await presenceSource.friends(id) : []
        friendCache.set(id, { until: Date.now() + 30_000, rows })
        return rows
    }
    async function onlineFriends(io: FeatureIo, id: number) {
        const rows = await friends(id)
        if (!presenceSource?.online) return rows.filter((friend) => online.has(friend.id))
        if (!rows.length) return rows
        const present = await presenceSource.online(io, rows.map((friend) => friend.id))
        return rows.filter((friend) => present.has(friend.id))
    }
    async function push(io: FeatureContext["io"], id: number, username: string, active: boolean) {
        const source = presenceSource
        if (!source) return
        const payload = { username, userId: id, peerUserId: id, online: active }
        const recipients = await friends(id)
        if (source.online) {
            if (!recipients.length) return
            const rooms = await Promise.all(recipients.map((friend) => source.audience(friend.id, [id, friend.id])))
            if ((await source.online(io, [id])).has(id) === active) io.to(rooms).emit("presence:changed", payload)
            return
        }
        for (const friend of recipients) {
            const room = await source.audience(friend.id, [id, friend.id])
            if (online.has(id) !== active) return
            io.to(room).emit("presence:changed", payload)
        }
    }
    function invalidatePresenceFriends(...ids: number[]) {
        for (const id of ids) friendCache.delete(id)
    }
    function onConnect(socket: FeatureContext["socket"], publisher: FeatureIo | false = socket.nsp.server): void {
        const user = socket.user,
            id = user?.id ?? user?.userId
        if (!user || typeof id !== "number") return
        if (presenceSource?.online) {
            const scheduled = offlineTimers.get(id)
            if (scheduled) {
                clearTimeout(scheduled)
                offlineTimers.delete(id)
            } else if (publisher && user.username) {
                void push(publisher, id, user.username, true).catch((error) => console.error("presence:connect", error))
            }
            return
        }
        let presence = online.get(id)
        const wasOnline = !!presence
        if (!presence) {
            presence = { username: user.username, sockets: new Set() }
            online.set(id, presence)
        }
        if (presence.offlineTimer) clearTimeout(presence.offlineTimer)
        presence.sockets.add(socket.id)
        if (!wasOnline && publisher)
            void push(publisher, id, user.username, true).catch((error) => console.error("presence:connect", error))
    }
    function onDisconnect(socket: FeatureContext["socket"], publisher: FeatureIo | false = socket.nsp.server): void {
        const id = socket.user?.id ?? socket.user?.userId
        if (typeof id !== "number") return
        if (presenceSource?.online) {
            const username = socket.user?.username
            if (!publisher || !username || offlineTimers.has(id)) return
            const timer = setTimeout(() => {
                offlineTimers.delete(id)
                void push(publisher, id, username, false).catch((error) => console.error("presence:disconnect", error))
            }, 5000).unref()
            offlineTimers.set(id, timer)
            return
        }
        const presence = online.get(id)
        if (!presence) return
        presence.sockets.delete(socket.id)
        if (presence.sockets.size) return
        presence.offlineTimer = setTimeout(() => {
            if (presence.sockets.size || online.get(id) !== presence) return
            online.delete(id)
            friendCache.delete(id)
            if (!publisher) return
            void push(publisher, id, presence.username, false)
                .finally(() => friendCache.delete(id))
                .catch((error) => console.error("presence:disconnect", error))
        }, 5000)
        presence.offlineTimer.unref()
    }
    function registerPresenceHandlers({ io, socket, user }: FeatureContext, delegate?: PresenceDelegate): void {
        socket.on("presence:ping", () => {})
        socket.on("ping:measure", (clientTs: unknown, callback: unknown) => {
            if (typeof clientTs === "number" && Number.isFinite(clientTs)) socketAck<number>(callback)?.(clientTs)
        })
        socket.on("presence:listByUserId", async (callback: unknown) => {
            if (delegate?.("presence:listByUserId", callback)) return
            const ack = socketAck<number[]>(callback)
            try {
                ack?.((await onlineFriends(io, user.id)).map((friend) => friend.id))
            } catch {
                ack?.([])
            }
        })
        socket.on("presence:list", async (callback: unknown) => {
            if (delegate?.("presence:list", callback)) return
            const ack = socketAck<string[]>(callback)
            try {
                ack?.((await onlineFriends(io, user.id)).map((friend) => friend.username))
            } catch (error) {
                console.error("presence:list", error)
                ack?.([])
            }
        })
    }

    return { setPresenceSource, invalidatePresenceFriends, onConnect, onDisconnect, registerPresenceHandlers }
}
