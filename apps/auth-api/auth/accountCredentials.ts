import { pool } from "../../shared/config"
import { assertAccessSessionActive, type AccessTokenPayload } from "./accessToken"
import { revokeAllRefreshTokensForUser } from "./refreshToken"

export async function updateAccountCredentials(
    session: AccessTokenPayload,
    verifiedHash: string,
    newHash: string | null
): Promise<boolean> {
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        const account = await client.query<{ password_hash: string }>(
            "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
            [session.id]
        )
        if (account.rows[0]?.password_hash !== verifiedHash) {
            await client.query("ROLLBACK")
            return false
        }
        await assertAccessSessionActive(session, client)
        if (newHash === null) {
            await client.query("DELETE FROM users WHERE id=$1", [session.id])
        } else {
            await client.query("UPDATE users SET password_hash=$1, auth_version=auth_version+1 WHERE id=$2", [newHash, session.id])
            await client.query("DELETE FROM password_recovery WHERE user_id=$1", [session.id])
            await revokeAllRefreshTokensForUser(session.id, client)
        }
        await client.query("COMMIT")
        return true
    } catch (error) {
        await client.query("ROLLBACK")
        throw error
    } finally {
        client.release()
    }
}
