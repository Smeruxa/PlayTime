import type { PoolClient } from "pg"
import { pool } from "../../shared/config"
import fs from "fs"
import path from "path"
import { finalizeMediaObject, mediaBaseDir } from "./mediaStorage"

export function voiceBaseDir(): string {
    return mediaBaseDir("voice")
}

export function voiceStagingPath(voiceKey: string): string {
    return path.join(voiceBaseDir(), "staging", `${voiceKey}.webm`)
}

export function voiceFinalPath(voiceKey: string): string {
    return path.join(voiceBaseDir(), `${voiceKey}.webm`)
}

export function ensureVoiceDirs(): void {
    fs.mkdirSync(path.join(voiceBaseDir(), "staging"), { recursive: true })
}

export async function moveVoiceStagingToFinal(voiceKey: string, db: Pick<PoolClient, "query"> = pool): Promise<void> {
    const from = voiceStagingPath(voiceKey)
    const to = voiceFinalPath(voiceKey)
    try { fs.renameSync(from, to) }
    catch (err) {
        if ((err as Error & {code?:string}).code !== "ENOENT" || !fs.existsSync(to)) throw err
    }
    await finalizeMediaObject(voiceKey, db)
}

export async function unlinkVoiceFile(voiceKey: string | null | undefined): Promise<void> {
    if (!voiceKey) return
    const p = voiceFinalPath(voiceKey)
    try {
        await fs.promises.unlink(p)
    } catch {
    }
}
