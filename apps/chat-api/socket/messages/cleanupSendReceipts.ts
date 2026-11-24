import type { PoolClient } from "pg"

export async function cleanupSendReceipts(db: Pick<PoolClient, "query">): Promise<void> {
    await db.query("DELETE FROM message_send_receipts WHERE created_at < NOW() - INTERVAL '7 days'")
}
