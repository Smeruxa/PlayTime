import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { isIP } from "node:net"
import { ipKeyGenerator } from "express-rate-limit"
import type { Request, Response } from "express"
import Redis, { type RedisOptions } from "ioredis"
import { JWT_SECRET, redis } from "../../shared/config"

export const ADMIN_SESSION_COOKIE = "pt_admin_session_v1"
export const ADMIN_SESSION_COOKIE_PATH = "/playtime/admin"
export const ADMIN_SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000
export const ADMIN_SESSION_IDLE_MS = 30 * 60 * 1000
export const ADMIN_LOGIN_BLOCK_SECONDS = 30 * 60
const REDIS_TIMEOUT_MS = 1800
const ADMIN_INVALID_KEY_BUDGET = "playtime:admin:login:budget"

export type AdminSession = { createdAt: string; expiresAt: string; idleExpiresAt: string }
type SessionTimes = { createdAt: number; expiresAt: number; idleExpiresAt: number }
export type AdminLoginAttempt = { fingerprint: string; blockKey: string; lockKey: string; lockToken: string }
export type AdminLoginBudget = { attempt: AdminLoginAttempt | null; retryAfter: number }

const connectionOptions: RedisOptions = {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    autoResendUnfulfilledCommands: false,
    commandTimeout: 1500,
    connectTimeout: 1200
}
const sessionRedis = process.env.ADMIN_REDIS_URL
    ? new Redis(process.env.ADMIN_REDIS_URL, connectionOptions)
    : redis.duplicate(connectionOptions)
const localSessionSigningKey = randomBytes(32)
sessionRedis.on("error", () => {})
let connecting: Promise<unknown> | null = null

async function bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error("Admin session storage unavailable")), REDIS_TIMEOUT_MS)
                timer.unref()
            })
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

async function ready() {
    if (sessionRedis.status === "ready") return
    if (!connecting && sessionRedis.status === "wait") {
        connecting = bounded(sessionRedis.connect()).finally(() => {
            connecting = null
        })
    }
    if (connecting) await connecting
    if (String(sessionRedis.status) !== "ready") throw new Error("Admin session storage unavailable")
}

async function evaluate(script: string, keys: string[], args: (string | number)[] = []): Promise<unknown> {
    await ready()
    return bounded(sessionRedis.eval(script, keys.length, ...keys, ...args))
}

export function closeAdminSessionStore(): void {
    sessionRedis.disconnect()
}

export function getAdminAccessKeyFingerprint(): string | null {
    const value = process.env.ADMIN_ACCESS_KEY_HASH
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null
}

export function isAdminOriginAllowed(req: Request): boolean {
    if (req.get("Sec-Fetch-Site") === "cross-site") return false
    const origin = req.get("Origin")
    const configured =
        process.env.SITE_ORIGIN?.trim() ||
        (process.env.NODE_ENV !== "production" ? process.env.SITE_DEV_ORIGIN?.trim() : "")
    if (!origin || !configured) return false
    try {
        const site = new URL(configured)
        if (!["http:", "https:"].includes(site.protocol)) return false
        if (process.env.NODE_ENV === "production" && site.protocol !== "https:") return false
        const origins = new Set([site.origin])
        if (site.hostname.includes(".") && !isIP(site.hostname)) {
            site.hostname = site.hostname.startsWith("www.") ? site.hostname.slice(4) : `www.${site.hostname}`
            origins.add(site.origin)
        }
        return origins.has(origin)
    } catch {
        return false
    }
}

export function isAdminRequestAllowed(req: Request): boolean {
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method)
    if (req.get("Sec-Fetch-Site") === "cross-site") return false
    if ((unsafe || req.headers.origin !== undefined) && !isAdminOriginAllowed(req)) return false
    return !unsafe || req.get("X-PlayTime-Admin") === "1"
}

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex")
}

export function adminSessionStorageKey(token: string, fingerprint: string): string {
    const secret = process.env.ADMIN_SESSION_SIGNING_KEY
    if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32))
        throw new Error("Configure ADMIN_SESSION_SIGNING_KEY to enable administrator sessions")
    const digest = createHmac("sha256", secret || localSessionSigningKey).update(fingerprint).update(":").update(token).digest("hex")
    return `playtime:admin:session:${fingerprint}:${digest}`
}

export function readAdminSessionToken(req: Request): string | null {
    const matches = (req.headers.cookie || "")
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`))
    if (matches.length !== 1) return null
    const token = matches[0].slice(ADMIN_SESSION_COOKIE.length + 1)
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
}

export function setAdminSessionCookie(res: Response, token: string): void {
    res.cookie(ADMIN_SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: ADMIN_SESSION_COOKIE_PATH,
        maxAge: ADMIN_SESSION_ABSOLUTE_MS
    })
}

export function clearAdminSessionCookie(res: Response): void {
    res.clearCookie(ADMIN_SESSION_COOKIE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: ADMIN_SESSION_COOKIE_PATH
    })
}

function timesToSession(raw: unknown): AdminSession | null {
    if (typeof raw !== "string" || !raw) return null
    const times = JSON.parse(raw) as SessionTimes
    if (![times.createdAt, times.expiresAt, times.idleExpiresAt].every(Number.isSafeInteger)) {
        throw new Error("Invalid admin session")
    }
    return {
        createdAt: new Date(times.createdAt).toISOString(),
        expiresAt: new Date(times.expiresAt).toISOString(),
        idleExpiresAt: new Date(times.idleExpiresAt).toISOString()
    }
}

const VALIDATE_SESSION = `
local raw = redis.call('GET', KEYS[1])
if not raw then return '' end
local ok, value = pcall(cjson.decode, raw)
if not ok or type(value) ~= 'table' or type(value.createdAt) ~= 'number' or type(value.expiresAt) ~= 'number' or type(value.idleExpiresAt) ~= 'number' then
  redis.call('DEL', KEYS[1]); return ''
end
local time = redis.call('TIME')
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
if value.expiresAt <= now or value.idleExpiresAt <= now or value.createdAt > now or value.expiresAt-value.createdAt > tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1]); return ''
end
value.idleExpiresAt = math.min(now + tonumber(ARGV[1]), value.expiresAt)
local next = cjson.encode(value)
redis.call('PSETEX', KEYS[1], math.max(1, value.idleExpiresAt-now), next)
return next
`

export async function validateAdminSession(token: string, fingerprint: string): Promise<AdminSession | null> {
    return timesToSession(
        await evaluate(
            VALIDATE_SESSION,
            [adminSessionStorageKey(token, fingerprint)],
            [ADMIN_SESSION_IDLE_MS, ADMIN_SESSION_ABSOLUTE_MS]
        )
    )
}

export async function revokeAdminSession(token: string, fingerprint: string): Promise<void> {
    await evaluate("return redis.call('DEL', KEYS[1])", [adminSessionStorageKey(token, fingerprint)])
}

const LOGIN_BUDGET = `
local blocked = redis.call('TTL', KEYS[1])
if blocked > 0 then return {0, blocked} end
if redis.call('EXISTS', KEYS[2]) == 1 then return {0, 1} end
local perIp = tonumber(redis.call('GET', KEYS[3]) or '0')
if perIp >= 3 then return {0, math.max(1, redis.call('TTL', KEYS[3]))} end
redis.call('SET', KEYS[2], ARGV[1], 'PX', 10000)
if redis.call('INCR', KEYS[3]) == 1 then redis.call('EXPIRE', KEYS[3], 10) end
return {1, 0}
`

export async function beginAdminLogin(ip: string, fingerprint: string): Promise<AdminLoginBudget> {
    if (!isIP(ip)) throw new Error("Invalid client address")
    const ipHash = createHmac("sha256", JWT_SECRET)
        .update(`playtime-admin-login:v1:${ipKeyGenerator(ip, 56)}`)
        .digest("hex")
    const attempt = {
        fingerprint,
        blockKey: `playtime:admin:login:blocked:${fingerprint}:${ipHash}`,
        lockKey: `playtime:admin:login:attempt:${fingerprint}:${ipHash}`,
        lockToken: randomBytes(16).toString("hex")
    }
    const result = (await evaluate(
        LOGIN_BUDGET,
        [attempt.blockKey, attempt.lockKey, `playtime:admin:login:rate:${ipHash}`],
        [attempt.lockToken]
    )) as number[]
    return { attempt: result[0] === 1 ? attempt : null, retryAfter: Number(result[1]) }
}

export async function abandonAdminLogin(attempt: AdminLoginAttempt): Promise<void> {
    await evaluate(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        [attempt.lockKey],
        [attempt.lockToken]
    )
}

const FINISH_LOGIN = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return {2, 1, ''} end
local blocked = redis.call('TTL', KEYS[1])
if blocked > 0 then redis.call('DEL', KEYS[2]); return {2, blocked, ''} end
if ARGV[2] ~= '1' then
  if ARGV[6] == '1' then
    local count = tonumber(redis.call('GET', KEYS[5]) or '0')
    if count >= 300 then
      redis.call('DEL', KEYS[2])
      return {2, math.max(1, redis.call('TTL', KEYS[5])), ''}
    end
    if redis.call('INCR', KEYS[5]) == 1 then redis.call('EXPIRE', KEYS[5], 10) end
  end
  redis.call('SET', KEYS[1], '1', 'EX', ARGV[5])
  redis.call('DEL', KEYS[2])
  return {0, tonumber(ARGV[5]), ''}
end
local time = redis.call('TIME')
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
local value = cjson.encode({createdAt=now, expiresAt=now+tonumber(ARGV[4]), idleExpiresAt=now+tonumber(ARGV[3])})
if not redis.call('SET', KEYS[3], value, 'PX', ARGV[3], 'NX') then return redis.error_reply('Session collision') end
if KEYS[4] ~= KEYS[3] then redis.call('DEL', KEYS[4]) end
redis.call('DEL', KEYS[2])
return {1, 0, value}
`

export async function finishAdminLogin(attempt: AdminLoginAttempt, key: string, previousToken: string | null) {
    const candidate = Buffer.from(sha256(key), "hex")
    const expected = Buffer.from(attempt.fingerprint, "hex")
    const matches = timingSafeEqual(candidate, expected)
    const canonical = /^[A-Za-z0-9_-]{43}$/.test(key) && Buffer.from(key, "base64url").toString("base64url") === key
    const token = randomBytes(32).toString("base64url")
    const storageKey = adminSessionStorageKey(token, attempt.fingerprint)
    const result = (await evaluate(
        FINISH_LOGIN,
        [
            attempt.blockKey,
            attempt.lockKey,
            storageKey,
            previousToken ? adminSessionStorageKey(previousToken, attempt.fingerprint) : storageKey,
            ADMIN_INVALID_KEY_BUDGET
        ],
        [
            attempt.lockToken,
            matches && canonical ? "1" : "0",
            ADMIN_SESSION_IDLE_MS,
            ADMIN_SESSION_ABSOLUTE_MS,
            ADMIN_LOGIN_BLOCK_SECONDS,
            canonical ? "1" : "0"
        ]
    )) as [number, number, string]
    return {
        kind: result[0] === 1 ? ("allowed" as const) : result[0] === 0 ? ("invalid" as const) : ("blocked" as const),
        retryAfter: Number(result[1]),
        token: result[0] === 1 ? token : null,
        session: result[0] === 1 ? timesToSession(result[2]) : null
    }
}
