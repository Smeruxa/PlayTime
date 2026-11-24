export type SocketAck<T> = (payload: T) => void

export function socketAck<T>(callback: unknown): SocketAck<T> | undefined {
    if (typeof callback !== "function") return undefined
    return callback as SocketAck<T>
}
