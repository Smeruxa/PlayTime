import "socket.io"

declare module "socket.io" {
    interface Socket {
        user?: {
            id?: number
            userId?: number
            username: string
        }
    }

    interface Handshake {
        auth: {
            token?: string
        } & Record<string, unknown>
    }
}
