import { createHmac } from "node:crypto"
import type { FeatureIo } from "../../shared/socket/featureContext"

const turnCredentialLifetimeSeconds = 3600

export type IceServerWire = {
    urls: string | string[]
    username?: string
    credential?: string
}

export function getIceServers(userId?: number): IceServerWire[] {
    const servers: IceServerWire[] = []

    const stunRaw = process.env.WEBRTC_STUN_URLS?.trim()
    if (stunRaw) {
        for (const url of stunRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)) {
            servers.push({ urls: url })
        }
    } else {
        servers.push({ urls: "stun:stun.l.google.com:19302" })
    }

    const turnHost = process.env.WEBRTC_TURN_HOST?.trim()
    const secret = process.env.WEBRTC_TURN_SECRET?.trim()
    const turnUser =
        secret && userId
            ? `${Math.floor(Date.now() / 1000) + turnCredentialLifetimeSeconds}:${userId}`
            : process.env.WEBRTC_TURN_USERNAME?.trim()
    const turnCred =
        secret && turnUser
            ? createHmac("sha1", secret).update(turnUser).digest("base64")
            : process.env.WEBRTC_TURN_CREDENTIAL?.trim()

    if (turnHost) {
        const host = turnHost
            .replace(/^turn:/, "")
            .replace(/^turns:/, "")
            .split("?")[0]
        servers.push({
            urls: [`turn:${host}?transport=udp`, `turn:${host}?transport=tcp`],
            username: turnUser || undefined,
            credential: turnCred || undefined
        })
    } else {
        const turnUrl = process.env.WEBRTC_TURN_URL?.trim()
        if (turnUrl) {
            servers.push({
                urls: turnUrl,
                username: turnUser || undefined,
                credential: turnCred || undefined
            })
        }
    }

    return servers
}

export function sendCallIceServers(io: FeatureIo, ...users: number[]): void {
    for (const user of users) io.to(String(user)).emit("webrtc:config", { iceServers: getIceServers(user) })
}
