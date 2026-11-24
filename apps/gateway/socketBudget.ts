import type { Socket } from "socket.io"
import { packetByteLength } from "./packetBytes"

type Bucket = { tokens: number; at: number }
export function consumeBucket(bucket: Bucket, rate: number, capacity: number, cost = 1, now = Date.now()): boolean {
    if (!Number.isFinite(cost) || cost < 0) return false
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.at) * rate / 1000)
    bucket.at = now
    if (cost > bucket.tokens) return false
    bucket.tokens -= cost
    return true
}
const users = new Map<number, { sockets: Set<string>; control: Bucket; signaling: Bucket; media: Bucket; bytes: Bucket; active: number }>()

export function installSocketBudget(socket: Socket, userId: number): boolean {
    let budget = users.get(userId)
    const fresh = (): Bucket => ({ tokens: 0, at: Date.now() })
    if (!budget) {
        budget = { sockets: new Set(), control: { ...fresh(), tokens: 60 }, signaling: { ...fresh(), tokens: 600 }, media: { ...fresh(), tokens: 180 }, bytes: { ...fresh(), tokens: 16 * 1024 ** 2 }, active: 0 }
        users.set(userId, budget)
    }
    if (budget.sockets.size >= 8) return false
    budget.sockets.add(socket.id)
    socket.once("disconnect", () => {
        budget!.sockets.delete(socket.id)
        if (!budget!.sockets.size && budget!.active === 0) users.delete(userId)
    })
    let rejected = 0
    socket.use((packet, next) => {
        const event = typeof packet[0] === "string" ? packet[0] : ""
        const media = event.endsWith(":broadcast")
        const signaling = event === "webrtc:signal"
        const bucket = media ? budget!.media : signaling ? budget!.signaling : budget!.control
        const rate = media || signaling ? 120 : 30
        const capacity = media ? 180 : signaling ? 600 : 60
        const bytes = packetByteLength(packet)
        if (
            (!signaling || bytes <= 160 * 1024) &&
            consumeBucket(bucket, rate, capacity) &&
            consumeBucket(budget!.bytes, 8 * 1024 ** 2, 16 * 1024 ** 2, bytes)
        ) return next()
        const callback = packet[packet.length - 1]
        if (typeof callback === "function") callback({ err: "Слишком много запросов. Повторите через несколько секунд." })
        if (++rejected >= 30) socket.disconnect(true)
        next(new Error("Rate limited"))
    })
    return true
}

export function boundedFeatureSocket(socket: Socket, userId: number): Socket {
    return new Proxy(socket, { get(target, key) {
        if (key === "on") return (event: string, handler: (...args: any[]) => unknown) => {
            if (event === "disconnect" || event === "disconnecting") { target.on(event, handler); return target }
            target.on(event, (...args: any[]) => {
                const budget = users.get(userId)
                if (budget && budget.active >= 8) {
                    const ack = args[args.length - 1]
                    if (typeof ack === "function") ack({ err: "Сервер обрабатывает ваши запросы. Повторите попытку." })
                    return
                }
                if (budget) budget.active++
                void Promise.resolve().then(() => handler(...args)).catch(error => console.error("socket handler", event, error)).finally(() => {
                    if (budget) {
                        budget.active--
                        if (!budget.sockets.size && budget.active === 0) users.delete(userId)
                    }
                })
            })
            return target
        }
        const value = Reflect.get(target, key)
        return typeof value === "function" ? value.bind(target) : value
    } }) as Socket
}
