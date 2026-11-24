import type { Server } from "socket.io"

declare global {
    namespace Express {
        interface Application {
            get(name: "io"): Server | undefined
            set(name: "io", value: Server): this
        }
    }
}

export {}
