import nacl from "tweetnacl"
import naclUtil from "tweetnacl-util"

export const MEDIA_MESSAGE_PREFIX = "PTMEDIA1:"
export type MediaDescriptor = {
    kind: "voice" | "attachment"
    storageKey: string
    key: string
    nonce: string
    mime: string
    filename: string
    sizeBytes: number
    durationSec?: number
}

const SAFE_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const SAFE_MIMES = new Set(
    Array.from(SAFE_IMAGES).concat([
        "application/octet-stream",
        "application/pdf",
        "application/zip",
        "text/plain",
        "audio/webm",
        "audio/ogg",
        "audio/mp4"
    ])
)

export const isPreviewImage = (mime: string): boolean => SAFE_IMAGES.has(mime)
export function safeMediaMime(mime: string): string {
    const value = mime.split(";")[0].trim().toLowerCase()
    return SAFE_MIMES.has(value) ? value : "application/octet-stream"
}

export async function encryptMedia(blob: Blob): Promise<{ blob: Blob; key: string; nonce: string }> {
    const key = nacl.randomBytes(nacl.secretbox.keyLength)
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
    const encrypted = nacl.secretbox(new Uint8Array(await blob.arrayBuffer()), nonce, key)
    return {
        blob: new Blob([new Uint8Array(encrypted)], { type: "application/octet-stream" }),
        key: naclUtil.encodeBase64(key),
        nonce: naclUtil.encodeBase64(nonce)
    }
}

export const encodeMediaMessage = (descriptor: MediaDescriptor): string =>
    MEDIA_MESSAGE_PREFIX + JSON.stringify(descriptor)

export function decodeMediaMessage(plaintext: string): MediaDescriptor | null {
    if (!plaintext.startsWith(MEDIA_MESSAGE_PREFIX) || plaintext.length > 2000) return null
    try {
        const d = JSON.parse(plaintext.slice(MEDIA_MESSAGE_PREFIX.length)) as MediaDescriptor
        if (
            !d ||
            (d.kind !== "voice" && d.kind !== "attachment") ||
            typeof d.storageKey !== "string" ||
            !/^[a-f0-9-]{36}$/.test(d.storageKey) ||
            typeof d.key !== "string" ||
            d.key.length !== 44 ||
            naclUtil.decodeBase64(d.key).length !== 32 ||
            typeof d.nonce !== "string" ||
            d.nonce.length !== 32 ||
            naclUtil.decodeBase64(d.nonce).length !== 24 ||
            typeof d.mime !== "string" ||
            typeof d.filename !== "string" ||
            d.filename.length > 200 ||
            !Number.isSafeInteger(d.sizeBytes) ||
            d.sizeBytes < 0 ||
            d.sizeBytes > 12 * 1024 * 1024 ||
            (d.kind === "voice" &&
                (typeof d.durationSec !== "number" ||
                    !Number.isFinite(d.durationSec) ||
                    d.durationSec <= 0 ||
                    d.durationSec > 3600))
        )
            return null
        const filename = Array.from(d.filename, (c) =>
            c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "/" || c === "\\" ? "_" : c
        ).join("")
        return { ...d, mime: safeMediaMime(d.mime), filename }
    } catch {
        return null
    }
}

function matchesImageSignature(bytes: Uint8Array, mime: string): boolean {
    const starts = (prefix: number[]) => prefix.every((value, index) => bytes[index] === value)
    if (mime === "image/png") return starts([137, 80, 78, 71, 13, 10, 26, 10])
    if (mime === "image/jpeg") return starts([255, 216, 255])
    if (mime === "image/gif") return starts([71, 73, 70, 56]) && [55, 57].includes(bytes[4]) && bytes[5] === 97
    if (mime === "image/webp")
        return starts([82, 73, 70, 70]) && [87, 69, 66, 80].every((value, i) => bytes[i + 8] === value)
    return false
}

export async function mediaBlobForPlayback(blob: Blob, mime: string, descriptor?: MediaDescriptor): Promise<Blob> {
    let bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer())
    if (descriptor) {
        const opened = nacl.secretbox.open(
            bytes,
            naclUtil.decodeBase64(descriptor.nonce),
            naclUtil.decodeBase64(descriptor.key)
        )
        if (!opened || opened.byteLength !== descriptor.sizeBytes) throw new Error("Не удалось расшифровать вложение")
        bytes = opened
    }
    const safe = safeMediaMime(descriptor?.mime || mime)
    const type = isPreviewImage(safe) && !matchesImageSignature(bytes, safe) ? "application/octet-stream" : safe
    return new Blob([new Uint8Array(bytes)], { type })
}
