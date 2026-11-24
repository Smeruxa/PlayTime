import nacl from "tweetnacl"
import util from "tweetnacl-util"

const ITERATIONS = 600_000
const bytes = (value: Uint8Array): ArrayBuffer => new Uint8Array(value).buffer
async function backupKey(password: string, salt: Uint8Array) {
    if (password.length < 12) throw new Error("Для копии используйте пароль длиной не менее 12 символов")
    const material = await crypto.subtle.importKey("raw", bytes(new TextEncoder().encode(password)), "PBKDF2", false, [
        "deriveKey"
    ])
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: bytes(salt), iterations: ITERATIONS, hash: "SHA-256" },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    )
}

export async function encryptKeyBackup(
    userId: number,
    keys: Record<string, string>,
    password: string
): Promise<string> {
    validateBackupKeys(keys)
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await backupKey(password, salt)
    const data = new TextEncoder().encode(JSON.stringify({ userId, keys }))
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bytes(iv) }, key, bytes(data))
    return JSON.stringify({
        format: "playtime-key-backup-v1",
        salt: util.encodeBase64(salt),
        iv: util.encodeBase64(iv),
        ciphertext: util.encodeBase64(new Uint8Array(ciphertext))
    })
}

export function validateBackupKeys(keys: Record<string, string>): void {
    if (!keys || typeof keys !== "object" || Array.isArray(keys) || !keys.dm || Object.keys(keys).length > 2000)
        throw new Error("В копии нет ключа переписки")
    for (const [name, value] of Object.entries(keys)) {
        if (
            !/^(dm|room:[1-9]\d*(?::[1-9]\d*)?)$/.test(name) ||
            typeof value !== "string" ||
            value.length !== 44 ||
            util.decodeBase64(value).length !== nacl.box.secretKeyLength
        )
            throw new Error("Некорректная копия ключей")
    }
}

export async function decryptKeyBackup(
    source: string,
    userId: number,
    password: string
): Promise<Record<string, string>> {
    if (source.length > 256_000) throw new Error("Файл копии слишком большой")
    try {
        const file = JSON.parse(source) as { format: string; salt: string; iv: string; ciphertext: string }
        if (file.format !== "playtime-key-backup-v1") throw new Error("format")
        const salt = util.decodeBase64(file.salt),
            iv = util.decodeBase64(file.iv)
        if (salt.length !== 16 || iv.length !== 12) throw new Error("format")
        const key = await backupKey(password, salt)
        const plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: bytes(iv) },
            key,
            bytes(util.decodeBase64(file.ciphertext))
        )
        const payload = JSON.parse(new TextDecoder().decode(plaintext)) as {
            userId: number
            keys: Record<string, string>
        }
        if (payload.userId !== userId) throw new Error("other-account")
        validateBackupKeys(payload.keys)
        return payload.keys
    } catch (error) {
        if (error instanceof Error && error.message === "other-account")
            throw new Error("Эта копия принадлежит другому аккаунту")
        throw new Error("Не удалось открыть копию: проверьте пароль и файл")
    }
}
