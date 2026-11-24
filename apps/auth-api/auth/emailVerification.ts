import { pool, redis, JWT_SECRET } from "../../shared/config"
import { newRecoveryCode, recoveryCodeHash } from "./recoveryCode"
import { sendRecoveryMail } from "../services/recoveryMail"
import crypto from "node:crypto"
import type { PoolClient } from "pg"
import { createEmailCodeLimits } from "./emailCodeLimits"

const codeLimits = createEmailCodeLimits(redis, JWT_SECRET)

export async function sendEmailVerification(userId: number, email: string, correctedAddress = false): Promise<void> {
    const address = crypto.createHash("sha256").update(email).digest("hex")
    const sentKey = `verification:sent:${userId}:${address}`
    const reservation = crypto.randomUUID()
    if (correctedAddress) await redis.del(sentKey)
    if (!await redis.set(sentKey, reservation, "EX", 60, "NX")) return
    let client: PoolClient | undefined
    let transaction = false
    try {
        const code = newRecoveryCode()
        await pool.query("DELETE FROM email_verification_codes WHERE expires_at < NOW()")
        client = await pool.connect()
        await client.query("BEGIN")
        transaction = true
        const current = await client.query("SELECT id FROM users WHERE id=$1 AND email=$2 AND email_verified_at IS NULL AND is_blocked=FALSE AND (is_guest=FALSE OR guest_registration_pending=TRUE) FOR UPDATE", [userId, email])
        if (!current.rows.length || !(await codeLimits.canTry("verification", userId)) || !(await codeLimits.claimDelivery(email))) {
            await client.query("COMMIT")
            transaction = false
            return
        }
        await client.query(`INSERT INTO email_verification_codes(user_id, code_hash, email, expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '15 minutes')
            ON CONFLICT(user_id) DO UPDATE SET code_hash=EXCLUDED.code_hash, email=EXCLUDED.email, expires_at=EXCLUDED.expires_at, attempts=0`, [userId, recoveryCodeHash(code, JWT_SECRET + ":email-verification"), email])
        await client.query("COMMIT")
        transaction = false
        client.release()
        client = undefined
        await sendRecoveryMail(email, code, "verification")
    } catch (error) {
        if (transaction) await client?.query("ROLLBACK").catch(() => {})
        await redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, sentKey, reservation).catch(() => {})
        throw error
    } finally { client?.release() }
}
