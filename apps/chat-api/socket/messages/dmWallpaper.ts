import { resolvePeer, emitPeerEvent } from "../peerIdentity"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { socketAck } from "../../../shared/types/socket/ack"
import {
    MAX_WALLPAPER_PAYLOAD_CHARS,
    parseDmWallpaperState,
    type DmWallpaperState
} from "../../../shared/types/contracts/dmWallpaper"
import { pool, normalizeUsername } from "./helpers"

function orderedPairIds(a: number, b: number): [number, number] {
    return a < b ? [a, b] : [b, a]
}

export default function registerDmWallpaper({ io, socket, user }: FeatureContext): void {
    const uid = user.id

    socket.on("dmWallpaper:get", async (data: unknown, callback: unknown) => {
        const ack = socketAck<{ state?: DmWallpaperState; err?: string }>(callback)
        if (!ack) return
        const peerUsername = normalizeUsername((data as { peerUsername?: unknown })?.peerUsername)
        if (!peerUsername && (data as { peerUserId?: unknown })?.peerUserId === undefined)
            return ack({ err: "Некорректный пользователь", state: { kind: "none" } })

        try {
            const peer = await resolvePeer((data as { peerUserId?: unknown })?.peerUserId, peerUsername, {
                allowArchived: true
            })
            if (!peer) return ack({ err: "Пользователь не найден", state: { kind: "none" } })
            const peerId = peer.id

            const friend = await pool.query(
                "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
                [uid, peerId]
            )
            if (friend.rows.length === 0) return ack({ err: "Нет доступа", state: { kind: "none" } })

            const [low, high] = orderedPairIds(uid, peerId)
            const row = await pool.query<{ payload: string }>(
                "SELECT payload FROM dm_wallpapers WHERE user_a_id = $1 AND user_b_id = $2",
                [low, high]
            )
            if (row.rows.length === 0) return ack({ state: { kind: "none" } })

            let parsed: unknown
            try {
                parsed = JSON.parse(row.rows[0].payload) as unknown
            } catch {
                return ack({ state: { kind: "none" } })
            }
            const state = parseDmWallpaperState(parsed)
            return ack({ state: state ?? { kind: "none" } })
        } catch (e) {
            console.error("dmWallpaper:get", e)
            return ack({ err: "Ошибка сервера", state: { kind: "none" } })
        }
    })

    socket.on("dmWallpaper:set", async (data: unknown, callback: unknown) => {
        const ack = socketAck<{ err?: string }>(callback)
        if (!ack) return

        const peerUsername = normalizeUsername((data as { peerUsername?: unknown })?.peerUsername)
        const rawState = (data as { state?: unknown })?.state
        if (!peerUsername && (data as { peerUserId?: unknown })?.peerUserId === undefined)
            return ack({ err: "Некорректный пользователь" })

        const state = parseDmWallpaperState(rawState)
        if (!state) return ack({ err: "Некорректные обои" })

        try {
            const peer = await resolvePeer((data as { peerUserId?: unknown })?.peerUserId, peerUsername, {})
            if (!peer) return ack({ err: "Пользователь не найден" })
            const peerId = peer.id

            const friend = await pool.query(
                "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
                [uid, peerId]
            )
            if (friend.rows.length === 0) return ack({ err: "Нет доступа" })

            const [low, high] = orderedPairIds(uid, peerId)
            const payloadJson = JSON.stringify(state)

            if (state.kind === "none") {
                await pool.query("DELETE FROM dm_wallpapers WHERE user_a_id = $1 AND user_b_id = $2", [low, high])
            } else {
                if (payloadJson.length > MAX_WALLPAPER_PAYLOAD_CHARS) {
                    return ack({ err: "Обои слишком большие" })
                }
                await pool.query(
                    `INSERT INTO dm_wallpapers (user_a_id, user_b_id, payload, updated_at, updated_by_user_id)
                     VALUES ($1, $2, $3, NOW(), $4)
                     ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET
                       payload = EXCLUDED.payload,
                       updated_at = NOW(),
                       updated_by_user_id = EXCLUDED.updated_by_user_id`,
                    [low, high, payloadJson, uid]
                )
            }

            const body =
                state.kind === "none"
                    ? `${user.username} сбросил фон переписки`
                    : `${user.username} изменил фон переписки`
            const opIns = await pool.query<{ id: number; created_at: Date }>(
                `INSERT INTO dm_thread_operations (user_a_id, user_b_id, actor_username, op_kind, body)
                 VALUES ($1, $2, $3, 'wallpaper', $4)
                 RETURNING id, created_at`,
                [low, high, user.username, body]
            )
            const opRow = opIns.rows[0]
            const createdIso =
                opRow.created_at instanceof Date ? opRow.created_at.toISOString() : String(opRow.created_at)
            const opWire = { id: -opRow.id, text: body, created_at: createdIso }

            await emitPeerEvent(io, uid, [uid, peerId], "dmWallpaper:update", {
                peerUsername,
                peerUserId: peerId,
                state
            })
            await emitPeerEvent(io, peerId, [uid, peerId], "dmWallpaper:update", {
                peerUsername: user.username,
                peerUserId: uid,
                state
            })
            await emitPeerEvent(io, uid, [uid, peerId], "dmThreadOp:new", {
                peerUsername,
                peerUserId: peerId,
                op: opWire
            })
            await emitPeerEvent(io, peerId, [uid, peerId], "dmThreadOp:new", {
                peerUsername: user.username,
                peerUserId: uid,
                op: opWire
            })

            return ack({})
        } catch (e) {
            console.error("dmWallpaper:set", e)
            return ack({ err: "Не удалось сохранить" })
        }
    })
}
