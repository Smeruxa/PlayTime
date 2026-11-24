import type { PoolClient } from "pg"
import { pool } from "../shared/config"
import { cleanupMediaStorage } from "./services/mediaStorage"
import { cleanupSendReceipts } from "./socket/messages/cleanupSendReceipts"

type MaintenanceJob = (db: PoolClient) => Promise<void>

async function runExclusive(lock: number, job: MaintenanceJob): Promise<void> {
    const db = await pool.connect()
    let reusable = false
    try {
        const { rows: [status] } = await db.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock($1) AS locked",
            [lock]
        )
        if (!status.locked) {
            reusable = true
            return
        }
        try {
            await job(db)
        } finally {
            const { rows: [status] } = await db.query<{ unlocked: boolean }>(
                "SELECT pg_advisory_unlock($1) AS unlocked",
                [lock]
            )
            reusable = status.unlocked
        }
    } finally {
        db.release(!reusable)
    }
}

const mediaCleanup = () => runExclusive(1919247473, cleanupMediaStorage)
const receiptCleanup = () => runExclusive(1919247474, cleanupSendReceipts)

export async function startChatMaintenance(): Promise<() => void> {
    await Promise.all([mediaCleanup(), receiptCleanup()])
    const stopMedia = setInterval(
        () => {
            void mediaCleanup().catch((error) => console.error("media cleanup", error))
        },
        10 * 60 * 1000
    ).unref()
    const stopReceipts = setInterval(
        () => {
            void receiptCleanup().catch((error) => console.error("receipt cleanup", error))
        },
        60 * 60 * 1000
    ).unref()
    return () => {
        clearInterval(stopMedia)
        clearInterval(stopReceipts)
    }
}
