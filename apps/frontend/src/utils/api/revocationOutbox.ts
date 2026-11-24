import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"
import { API_BASE } from "../../config"
import { withRequestDeadline } from "./requestDeadline"

export const REVOCATION_OUTBOX_KEY = "playtime:revocation-outbox:v1"
const MAX_AGE_MS = 7 * 86400_000
const MAX_ENTRIES = 20
export type RevocationProof = { refreshTokenHash: string; createdAt: number; attempts: number; lastAttemptAt: number }
const memory = new Map<string, RevocationProof>()
const volatileProofs = new Set<string>()
const inFlight = new Map<string, Promise<void>>()
const storageKey = (hash: string) => `${REVOCATION_OUTBOX_KEY}:${hash}`

function validProof(value: unknown): value is RevocationProof {
    if (!value || typeof value !== "object") return false
    const entry = value as Partial<RevocationProof>
    return (
        typeof entry.refreshTokenHash === "string" &&
        /^[a-f0-9]{64}$/.test(entry.refreshTokenHash) &&
        typeof entry.createdAt === "number" &&
        Number.isFinite(entry.createdAt) &&
        entry.createdAt > Date.now() - MAX_AGE_MS &&
        entry.createdAt <= Date.now() &&
        typeof entry.attempts === "number" &&
        Number.isInteger(entry.attempts) &&
        entry.attempts >= 0 &&
        typeof entry.lastAttemptAt === "number" &&
        Number.isFinite(entry.lastAttemptAt)
    )
}

function remove(hash: string) {
    memory.delete(hash)
    volatileProofs.delete(hash)
    try {
        localStorage.removeItem(storageKey(hash))
    } catch {
    }
}

function write(entry: RevocationProof) {
    memory.set(entry.refreshTokenHash, entry)
    try {
        localStorage.setItem(storageKey(entry.refreshTokenHash), JSON.stringify(entry))
        volatileProofs.delete(entry.refreshTokenHash)
    } catch {
        volatileProofs.add(entry.refreshTokenHash)
    }
}

function read(): RevocationProof[] {
    try {
        const found = new Map<string, RevocationProof>()
        const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        for (const key of keys) {
            if (!key?.startsWith(`${REVOCATION_OUTBOX_KEY}:`)) continue
            try {
                const entry: unknown = JSON.parse(localStorage.getItem(key) || "null")
                if (validProof(entry) && key === storageKey(entry.refreshTokenHash))
                    found.set(entry.refreshTokenHash, entry)
                else localStorage.removeItem(key)
            } catch {
                localStorage.removeItem(key)
            }
        }
        for (const hash of Array.from(volatileProofs)) {
            const entry = memory.get(hash)
            if (entry && validProof(entry)) found.set(hash, entry)
        }
        memory.clear()
        found.forEach((entry, hash) => memory.set(hash, entry))
    } catch {
    }
    const entries = Array.from(memory.values())
        .filter(validProof)
        .sort((first, second) => first.createdAt - second.createdAt)
    for (const entry of entries.slice(0, Math.max(0, entries.length - MAX_ENTRIES))) remove(entry.refreshTokenHash)
    return entries.slice(-MAX_ENTRIES)
}

export function queueSessionRevocation(refreshToken: string): string | null {
    if (!/^[a-f0-9]{64}$/.test(refreshToken)) return null
    const refreshTokenHash = bytesToHex(sha256(refreshToken))
    const entries = read()
    if (!entries.some((entry) => entry.refreshTokenHash === refreshTokenHash)) {
        write({ refreshTokenHash, createdAt: Date.now(), attempts: 0, lastAttemptAt: 0 })
        read()
    }
    return refreshTokenHash
}

export function sendQueuedRevocation(refreshTokenHash: string, force = false): Promise<void> {
    const pending = inFlight.get(refreshTokenHash)
    if (pending) return pending
    const proof = read().find((entry) => entry.refreshTokenHash === refreshTokenHash)
    if (!proof) return Promise.resolve()
    const delay = Math.min(3600_000, 30_000 * 2 ** Math.min(proof.attempts, 7))
    if (!force && proof.lastAttemptAt && Date.now() - proof.lastAttemptAt < delay) return Promise.resolve()
    write({ ...proof, attempts: proof.attempts + 1, lastAttemptAt: Date.now() })
    const task = withRequestDeadline(async (signal) => {
        const response = await fetch(`${API_BASE}/auth/revoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshTokenHash }),
            signal
        })
        if (!response.ok) throw new Error("Session revocation was not acknowledged")
        remove(refreshTokenHash)
    })
        .catch(() => {
        })
        .finally(() => {
            inFlight.delete(refreshTokenHash)
        })
    inFlight.set(refreshTokenHash, task)
    return task
}

export async function flushRevocationOutbox(): Promise<void> {
    const entries = read()
    for (const entry of entries) await sendQueuedRevocation(entry.refreshTokenHash)
}
