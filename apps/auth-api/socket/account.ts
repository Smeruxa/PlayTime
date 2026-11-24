import bcrypt from "bcrypt"
import type { FeatureContext } from "../../shared/socket/featureContext"
import { pool, redis } from "../../shared/deps"
import { authSessionChangeChannel } from "../../shared/runtime/authContracts"
import { socketAck } from "../../shared/types/socket/ack"
import type { RowPasswordHash } from "../../shared/types/db"
import { updateAccountCredentials } from "../auth/accountCredentials"
import { passwordPolicyError } from "../../shared/auth/passwordPolicy"

const LOCK_SECONDS = 3600
const MAX_DELETE_PASSWORD_FAILS = 3
const acctLockedKey = (userId: number) => `acct_locked:${userId}`
const deleteAcctFailsKey = (userId: number) => `delete_acct_fails:${userId}`

export interface ChangePasswordPayload {
    currentPassword?: unknown
    newPassword?: unknown
}

export interface ChangePasswordAck {
    success: boolean
    err?: string
}

export interface DeleteAccountPayload {
    password?: unknown
}

export interface DeleteAccountAck {
    success: boolean
    err?: string
    locked?: boolean
}

export default function registerAccount({ io, socket, user }: FeatureContext): void {
    const uid = user.id

    socket.on("user:changePassword", async (data: ChangePasswordPayload, callback: unknown) => {
        const cb = socketAck<ChangePasswordAck>(callback)
        if (!cb) return
        try {
            const actor = socket.data.accessSession
            if (actor?.id !== uid) return cb({ success: false, err: "Войдите в аккаунт снова." })
            const currentRaw = data?.currentPassword
            const newRaw = data?.newPassword
            if (typeof currentRaw !== "string" || !currentRaw)
                return cb({ success: false, err: "Введите текущий пароль" })
            const attemptKey = `change_password_attempts:${uid}`
            const attempts = await redis.incr(attemptKey)
            if (attempts === 1) await redis.expire(attemptKey, 900)
            if (attempts > 5) return cb({ success: false, err: "Слишком много попыток. Повторите позже." })
            const policyError = passwordPolicyError(newRaw)
            if (policyError) return cb({ success: false, err: policyError })
            const row = await pool.query<RowPasswordHash>("SELECT password_hash FROM users WHERE id=$1", [uid])
            if (row.rows.length === 0) return cb({ success: false, err: "Пользователь не найден" })
            const match = await bcrypt.compare(currentRaw, row.rows[0].password_hash)
            if (!match) return cb({ success: false, err: "Неверный текущий пароль" })

            const hashedPassword = await bcrypt.hash(newRaw as string, 12)
            const changed = await updateAccountCredentials(actor, row.rows[0].password_hash, hashedPassword)
            if (!changed) return cb({ success: false, err: "Пароль уже изменён. Войдите снова." })
            await redis.del(attemptKey)
            cb({ success: true })
            setImmediate(() => {
                io.to(uid.toString()).emit("session:revoked")
                io.in(uid.toString()).disconnectSockets(true)
            })
        } catch (err) {
            console.error("user:changePassword:error", err)
            cb({ success: false, err: "Ошибка при изменении пароля" })
        }
    })

    socket.on("user:deleteAccount", async (data: DeleteAccountPayload, callback: unknown) => {
        const cb = socketAck<DeleteAccountAck>(callback)
        if (!cb) return
        try {
            const actor = socket.data.accessSession
            if (actor?.id !== uid) return cb({ success: false, err: "Войдите в аккаунт снова." })
            const lockTtl = await redis.ttl(acctLockedKey(uid))
            if (lockTtl > 0) {
                return cb({
                    success: false,
                    locked: true,
                    err: `Аккаунт заблокирован после неверных попыток. Повторите через ${lockTtl} сек.`
                })
            }

            const raw = data?.password
            if (typeof raw !== "string" || !raw.trim()) {
                return cb({ success: false, err: "Введите пароль для подтверждения" })
            }
            const row = await pool.query<RowPasswordHash>("SELECT password_hash FROM users WHERE id=$1", [uid])
            if (row.rows.length === 0) return cb({ success: false, err: "Пользователь не найден" })
            const match = await bcrypt.compare(raw, row.rows[0].password_hash)
            if (!match) {
                const failKey = deleteAcctFailsKey(uid)
                const fails = await redis.incr(failKey)
                if (fails === 1) await redis.expire(failKey, LOCK_SECONDS)
                if (fails >= MAX_DELETE_PASSWORD_FAILS) {
                    await redis.set(acctLockedKey(uid), "1", "EX", LOCK_SECONDS)
                    await pool
                        .query("SELECT pg_notify($1, $2)", [
                            authSessionChangeChannel,
                            JSON.stringify(["user", String(uid)])
                        ])
                        .catch(() => console.error("Account lock notification unavailable"))
                    await redis.del(failKey)
                    cb({
                        success: false,
                        locked: true,
                        err: "Аккаунт заблокирован на 1 час из‑за неверного пароля при удалении."
                    })
                    setImmediate(() => {
                        try {
                            io.in(uid.toString()).disconnectSockets(true)
                        } catch (e) {
                            console.error("user:deleteAccount:disconnectSockets", e)
                        }
                    })
                    return
                }
                const left = MAX_DELETE_PASSWORD_FAILS - fails
                return cb({
                    success: false,
                    err: `Неверный пароль (неверных вводов: ${fails} из ${MAX_DELETE_PASSWORD_FAILS}, до блокировки на 1 ч. осталось ${left}).`
                })
            }

            const removed = await updateAccountCredentials(actor, row.rows[0].password_hash, null)
            if (!removed) return cb({ success: false, err: "Данные аккаунта изменились. Войдите снова." })
            await redis.del(deleteAcctFailsKey(uid), acctLockedKey(uid))
            cb({ success: true })
            setImmediate(() => {
                try {
                    io.to(uid.toString()).emit("session:revoked")
                    io.in(uid.toString()).disconnectSockets(true)
                } catch (e) {
                    console.error("user:deleteAccount:disconnect", e)
                }
            })
        } catch (err) {
            console.error("user:deleteAccount", err)
            cb({ success: false, err: "Не удалось удалить аккаунт" })
        }
    })
}
