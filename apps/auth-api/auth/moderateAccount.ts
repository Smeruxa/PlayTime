import type { AccountBlockCommand, AccountBlockResult } from "../../shared/runtime/authContracts"
import { logAdminAction } from "../../database/adminAudit"
import { pool } from "../../shared/config"
import type { FeatureIo } from "../../shared/socket/featureContext"
import { revokeAllRefreshTokensForUser } from "./refreshToken"
import { revokeUserCredentials } from "./sessionVersion"
import { setUserBlocked } from "./userAccount"

export async function moderateAccount(
    { userId, blocked, reason, clientIp }: AccountBlockCommand,
    io?: Pick<FeatureIo, "in" | "to">
): Promise<AccountBlockResult> {
    const client = await pool.connect()
    let result: AccountBlockResult
    try {
        await client.query("BEGIN")
        const { rows } = await client.query<{ is_admin: boolean }>(
            "SELECT is_admin FROM users WHERE id = $1 FOR UPDATE",
            [userId]
        )
        if (!rows[0]) {
            result = { kind: "missing" }
        } else if (rows[0].is_admin) {
            result = { kind: "protected" }
        } else {
            const state = await setUserBlocked(userId, blocked, reason, client)
            if (!state) throw new Error("Locked account disappeared")
            if (blocked) {
                await revokeUserCredentials(userId, client)
                await revokeAllRefreshTokensForUser(userId, client)
            }
            await logAdminAction(
                {
                    adminUserId: null,
                    action: blocked ? "user.block" : "user.unblock",
                    targetUserId: userId,
                    details: { clientIp, reason }
                },
                client
            )
            result = { kind: "updated", state }
        }
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined)
        throw error
    } finally {
        client.release()
    }
    if (result.kind === "updated" && blocked && io) {
        const room = String(userId)
        io.to(room).emit("session:revoked")
        io.in(room).disconnectSockets(true)
    }
    return result
}
