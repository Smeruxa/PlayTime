import path from "path"

const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/

export function isSafeFilename(name: string): boolean {
    if (!name || name.length > 255) return false
    if (name.includes("/") || name.includes("\\") || name.includes("..")) return false
    return SAFE_FILENAME.test(name)
}

export function sanitizeContentDispositionFilename(name: string): string {
    const base = path.basename(name || "file").slice(0, 200)
    let filename = ""
    for (const character of base) {
        filename += character.charCodeAt(0) < 32 || character === '"' || character === "\\" ? "_" : character
    }
    return filename || "file"
}

export function resolvePathInsideDir(dir: string, filename: string): string | null {
    const resolvedDir = path.resolve(dir)
    const resolved = path.resolve(resolvedDir, filename)
    if (resolved === resolvedDir) return null
    if (!resolved.startsWith(resolvedDir + path.sep)) return null
    return resolved
}
