import { callGeneration, type CallInstance } from "./instance"

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function ringKey(roomId: string, room: CallInstance): string {
    return `${roomId}\0${callGeneration(room)}`
}

export function scheduleCallRingTimeout(
    roomId: string,
    room: CallInstance,
    onTimeout: () => void,
    delayMs: number
): void {
    const key = ringKey(roomId, room)
    if (timers.has(key)) return
    const timer = setTimeout(() => {
        if (timers.get(key) !== timer) return
        timers.delete(key)
        onTimeout()
    }, delayMs)
    timers.set(key, timer)
}

export function clearCallRingTimeout(roomId: string, room: CallInstance): void {
    const key = ringKey(roomId, room)
    const timer = timers.get(key)
    if (timer) clearTimeout(timer)
    timers.delete(key)
}
