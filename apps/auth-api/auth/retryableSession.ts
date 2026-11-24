import crypto from "node:crypto"
import { archiveGuestIfInactive, notifyGuestArchived } from "./guestLifecycle"
import type { PoolClient } from "pg"
import { JWT_SECRET, pool } from "../../shared/config"
import { issueRefreshToken, refreshTokenTtlSeconds, type SessionMetadata, type SessionUser } from "./refreshToken"

export const validAuthRequestKey = (value: unknown): value is string =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex")
const deriveToken = (...parts: string[]) =>
    crypto.createHmac("sha256", JWT_SECRET).update(JSON.stringify(parts)).digest("hex")

export class AuthRetryError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        public readonly retrySuperseded = false
    ) {
        super(message)
    }
}

type Account = {
    id: number
    username: string
    email: string
    auth_version: string | number
    is_blocked: boolean
    is_guest: boolean
    guest_registration_pending: boolean
    guest_archived_at: Date | null
}
type Device = {
    id: string
    refresh_token_hash: string | null
    session_version: string | number
    expires_at: Date
    revoked_at: Date | null
    unexpired: boolean
}
type SessionResult = { user: Account; session: SessionUser; refreshToken: string }

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        const result = await work(client)
        await client.query("COMMIT")
        return result
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
    } finally {
        client.release()
    }
}

async function lockSession(client: PoolClient, id: string, userId: number) {
    const user = (
        await client.query<Account>(
            "SELECT id, username, email, auth_version, is_blocked, is_guest, guest_registration_pending, guest_archived_at FROM users WHERE id=$1 FOR UPDATE",
            [userId]
        )
    ).rows[0]
    const device = (
        await client.query<Device>(
            "SELECT id, refresh_token_hash, session_version, expires_at, revoked_at, expires_at>NOW() AS unexpired FROM auth_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE",
            [id, userId]
        )
    ).rows[0]
    if (
        !user ||
        !device ||
        device.revoked_at ||
        !device.unexpired ||
        user.is_blocked ||
        user.guest_archived_at ||
        Number(device.session_version) !== Number(user.auth_version)
    ) {
        throw new AuthRetryError(401, "Invalid or expired session")
    }
    const session: SessionUser = {
        id: user.id,
        username: user.username,
        sessionVersion: Number(user.auth_version),
        sessionId: device.id
    }
    return { user, device, session }
}

export async function createGuestSession(
    username: string,
    requestKey: string | undefined,
    metadata: SessionMetadata,
    createCredentials: () => Promise<{ email: string; passwordHash: string }>,
    assertAccountAllowed: (userId: number) => Promise<void> = async () => {}
): Promise<SessionResult> {
    return transaction(async (client) => {
        const proofHash = requestKey ? digest(requestKey) : undefined
        if (proofHash) {
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`guest:${proofHash}`])
            const receipt = (
                await client.query<{ username: string; session_id: string; user_id: number }>(
                    `SELECT r.username, r.session_id, s.user_id FROM auth_guest_receipts r
                 JOIN auth_sessions s ON s.id=r.session_id WHERE r.request_key_hash=$1`,
                    [proofHash]
                )
            ).rows[0]
            if (receipt) {
                if (receipt.username !== username)
                    throw new AuthRetryError(409, "Повторите вход с первоначальным никнеймом")
                const { user, device, session } = await lockSession(client, receipt.session_id, receipt.user_id)
                await assertAccountAllowed(user.id)
                const refreshToken = deriveToken("guest-v1", device.id, requestKey!)
                if (device.refresh_token_hash !== digest(refreshToken))
                    throw new AuthRetryError(409, "Вход уже завершён в другой вкладке", true)
                return { user, session, refreshToken }
            }
        }
        const { email, passwordHash } = await createCredentials()
        const user = (
            await client.query<Account>(
                `INSERT INTO users (username, email, password_hash, email_verified_at, is_guest)
             VALUES ($1, $2, $3, NULL, TRUE) RETURNING id, username, email, auth_version, is_blocked, is_guest, guest_registration_pending`,
                [username, email, passwordHash]
            )
        ).rows[0]
        const session: SessionUser = {
            id: user.id,
            username: user.username,
            sessionVersion: Number(user.auth_version),
            sessionId: crypto.randomUUID()
        }
        const refreshToken = await issueRefreshToken(session, metadata, {
            client,
            token: requestKey ? deriveToken("guest-v1", session.sessionId!, requestKey) : undefined
        })
        if (proofHash)
            await client.query(
                `INSERT INTO auth_guest_receipts(request_key_hash, username, session_id, expires_at)
             SELECT $1, $2, id, expires_at FROM auth_sessions WHERE id=$3`,
                [proofHash, username, session.sessionId]
            )
        return { user, session, refreshToken }
    })
}

export async function rotateRefreshSession(
    raw: string,
    requestKey: string | undefined,
    assertAccountAllowed: (userId: number) => Promise<void>
): Promise<SessionResult> {
    if (!validAuthRequestKey(raw)) throw new AuthRetryError(401, "Invalid or expired refresh")
    return transaction(async (client) => {
        const oldHash = digest(raw)
        const found = (
            await client.query<{ id: string; user_id: number }>(
                `SELECT id, user_id FROM auth_sessions WHERE refresh_token_hash=$1
             UNION ALL SELECT s.id, s.user_id FROM auth_refresh_receipts r
             JOIN auth_sessions s ON s.id=r.session_id WHERE r.previous_token_hash=$1 LIMIT 1`,
                [oldHash]
            )
        ).rows[0]
        if (!found) throw new AuthRetryError(401, "Invalid or expired refresh")
        const { user, device, session } = await lockSession(client, found.id, found.user_id)
        await assertAccountAllowed(user.id)
        const proofHash = requestKey ? digest(requestKey) : undefined
        const refreshToken = requestKey
            ? deriveToken("refresh-v1", device.id, raw, requestKey)
            : crypto.randomBytes(32).toString("hex")
        const nextHash = digest(refreshToken)
        if (device.refresh_token_hash !== oldHash) {
            const receipt = (
                await client.query<{ request_key_hash: string; next_token_hash: string; unexpired: boolean }>(
                    "SELECT request_key_hash, next_token_hash, expires_at>NOW() AS unexpired FROM auth_refresh_receipts WHERE previous_token_hash=$1 AND session_id=$2",
                    [oldHash, device.id]
                )
            ).rows[0]
            if (!proofHash || !receipt || receipt.request_key_hash !== proofHash || !receipt.unexpired)
                throw new AuthRetryError(401, "Invalid or expired refresh")
            if (receipt.next_token_hash !== nextHash) throw new AuthRetryError(401, "Invalid or expired refresh")
            if (device.refresh_token_hash !== nextHash)
                throw new AuthRetryError(409, "Refresh already superseded", true)
            return { user, session, refreshToken }
        }
        const updated = (
            await client.query<{ expires_at: Date }>(
                "UPDATE auth_sessions SET refresh_token_hash=$1, last_seen_at=NOW(), expires_at=NOW()+$2*INTERVAL '1 second' WHERE id=$3 RETURNING expires_at",
                [nextHash, refreshTokenTtlSeconds(), device.id]
            )
        ).rows[0]
        if (proofHash)
            await client.query(
                "INSERT INTO auth_refresh_receipts(previous_token_hash, request_key_hash, next_token_hash, session_id, expires_at) VALUES ($1,$2,$3,$4,$5)",
                [oldHash, proofHash, nextHash, device.id, updated.expires_at]
            )
        return { user, session, refreshToken }
    })
}

export async function revokeRetryableRefresh(raw: string, requestKey: string): Promise<string | undefined> {
    if (!validAuthRequestKey(raw) || !validAuthRequestKey(requestKey)) return
    let archivedUserId: number | undefined
    const revokedId = await transaction(async (client) => {
        const found = (
            await client.query<{ id: string; user_id: number }>(
                `SELECT id, user_id FROM auth_sessions WHERE refresh_token_hash=$1
             UNION ALL SELECT s.id, s.user_id FROM auth_refresh_receipts r
             JOIN auth_sessions s ON s.id=r.session_id WHERE r.previous_token_hash=$1 AND r.request_key_hash=$2 LIMIT 1`,
                [digest(raw), digest(requestKey)]
            )
        ).rows[0]
        if (!found) return
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [found.user_id])
        await client.query(
            "UPDATE auth_sessions SET revoked_at=NOW(), refresh_token_hash=NULL WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",
            [found.id, found.user_id]
        )
        if (await archiveGuestIfInactive(client, found.user_id, "logout")) archivedUserId = found.user_id
        return found.id
    })
    if (archivedUserId !== undefined) await notifyGuestArchived(archivedUserId)
    return revokedId
}

export async function revokeHashedRefresh(refreshTokenHash: string): Promise<string | undefined> {
    if (!validAuthRequestKey(refreshTokenHash)) return
    let archivedUserId: number | undefined
    const revokedId = await transaction(async (client) => {
        const found = (
            await client.query<{ id: string; user_id: number }>(
                `SELECT id, user_id FROM auth_sessions WHERE refresh_token_hash=$1
             UNION ALL SELECT s.id, s.user_id FROM auth_refresh_receipts r
             JOIN auth_sessions s ON s.id=r.session_id WHERE r.previous_token_hash=$1 LIMIT 1`,
                [refreshTokenHash]
            )
        ).rows[0]
        if (!found) return
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [found.user_id])
        await client.query(
            "UPDATE auth_sessions SET revoked_at=NOW(), refresh_token_hash=NULL WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",
            [found.id, found.user_id]
        )
        if (await archiveGuestIfInactive(client, found.user_id, "logout")) archivedUserId = found.user_id
        return found.id
    })
    if (archivedUserId !== undefined) await notifyGuestArchived(archivedUserId)
    return revokedId
}
