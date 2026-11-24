import type { PoolClient } from "pg"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { socketAck } from "../../../shared/types/socket/ack"
import type { MessageSendPayload } from "./contracts"
import { parsePositiveInt, pool } from "./helpers"
import { saveDirectMessage } from "./sendDm"
import { saveRoomMessage } from "./sendRoom"
import type { SavedMessage } from "./sendTypes"

type SendAck = { success: true; id: number; duplicate?: boolean } | { err: string }

const clientIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export default function registerMessageSend({ io, socket, user }: FeatureContext): void {
    socket.on("message:send", async (data: MessageSendPayload, callback: unknown) => {
        const ack = socketAck<SendAck>(callback)
        const incomingId = data?.clientMessageId
        if (incomingId !== undefined && (typeof incomingId !== "string" || !clientIdPattern.test(incomingId))) {
            return ack?.({ err: "Некорректный идентификатор сообщения" })
        }
        const clientId = incomingId?.toLowerCase()

        let client: PoolClient | null = null
        let saved: SavedMessage
        try {
            client = await pool.connect()
            await client.query("BEGIN")
            if (clientId) {
                await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [user.id, clientId])
                const { rows } = await client.query<{ message_id: number }>(
                    "SELECT message_id FROM message_send_receipts WHERE user_id = $1 AND client_message_id = $2",
                    [user.id, clientId]
                )
                if (rows.length) {
                    await client.query("COMMIT")
                    ack?.({ success: true, id: rows[0].message_id, duplicate: true })
                    return
                }
            }

            const content = data.message ?? data.content
            if (typeof content !== "string" || !content) throw new Error("Пустое сообщение")
            const message = { db: client, user, data, content, replyToId: parsePositiveInt(data.replyToId) || null }
            saved = data.roomId != null ? await saveRoomMessage(message) : await saveDirectMessage(message)

            if (clientId) {
                await client.query(
                    "INSERT INTO message_send_receipts(user_id, client_message_id, message_id) VALUES ($1, $2, $3)",
                    [user.id, clientId, saved.id]
                )
            }
            await client.query("COMMIT")
        } catch (error) {
            if (client) await client.query("ROLLBACK").catch(() => {})
            const message =
                error instanceof Error && !("code" in error)
                    ? error.message
                    : "Не удалось сохранить сообщение. Повторите попытку."
            socket.emit("message:send:error", { err: message, clientMessageId: incomingId })
            return ack?.({ err: message })
        } finally {
            client?.release()
        }

        try {
            await saved.deliver({ io, socket })
        } catch (error) {
            console.error("stored message realtime delivery", error)
        }
        ack?.({ success: true, id: saved.id })
    })
}
