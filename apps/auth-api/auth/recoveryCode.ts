import crypto from "node:crypto"

export function newRecoveryCode(): string {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0")
}
export function isRecoveryCodeFormat(code: unknown): code is string {
    return typeof code === "string" && (/^\d{6}$/.test(code) || /^[A-Fa-f0-9]{10}$/.test(code))
}
export function recoveryCodeHash(code: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(code.toUpperCase()).digest("hex")
}
export function matchesRecoveryCode(code: string, hash: string, secret: string): boolean {
    if (!isRecoveryCodeFormat(code) || !/^[a-f0-9]{64}$/.test(hash)) return false
    return crypto.timingSafeEqual(Buffer.from(recoveryCodeHash(code, secret), "hex"), Buffer.from(hash, "hex"))
}
