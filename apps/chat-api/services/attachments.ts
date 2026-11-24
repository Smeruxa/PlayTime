import type { PoolClient } from "pg"
import { pool } from "../../shared/config"
import fs from "fs"
import path from "path"
import { finalizeMediaObject, mediaBaseDir } from "./mediaStorage"

export function attachmentBaseDir(): string {
    return mediaBaseDir("attachment")
}

export function attachmentStagingPath(key: string): string {
    return path.join(attachmentBaseDir(), "staging", key)
}

export function attachmentFinalPath(key: string): string {
    return path.join(attachmentBaseDir(), key)
}

export function ensureAttachmentDirs(): void {
    fs.mkdirSync(path.join(attachmentBaseDir(), "staging"), { recursive: true })
}

export async function moveAttachmentStagingToFinal(key: string, db: Pick<PoolClient, "query"> = pool): Promise<void> {
    const from = attachmentStagingPath(key)
    const to = attachmentFinalPath(key)
    try { fs.renameSync(from, to) }
    catch (err) {
        if ((err as Error & {code?:string}).code !== "ENOENT" || !fs.existsSync(to)) throw err
    }
    await finalizeMediaObject(key, db)
}

export async function unlinkAttachmentFile(key: string | null | undefined): Promise<void> {
    if (!key) return
    const p = attachmentFinalPath(key)
    try {
        await fs.promises.unlink(p)
    } catch {
    }
}
