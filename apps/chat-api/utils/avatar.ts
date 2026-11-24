export const MAX_AVATAR_BYTES = 25 * 1024
export const MAX_AVATAR_DATA_URL_CHARS = Math.ceil(MAX_AVATAR_BYTES * 1.37) + 80

const MAX_PARAM_VALUE_LEN = 256

function isValidAvatarMimePrefix(prefix: string): boolean {
    const m = /^data:image\/(jpe?g|png|webp)(?=;|$)/i.exec(prefix)
    if (!m) return false
    let i = m[0].length
    while (i < prefix.length) {
        if (prefix.charAt(i) !== ";") return false
        i++
        const eq = prefix.indexOf("=", i)
        if (eq === -1) return false
        const name = prefix.slice(i, eq)
        if (!/^[a-zA-Z0-9-]+$/.test(name)) return false
        i = eq + 1
        let end = i
        while (end < prefix.length && prefix.charAt(end) !== ";") end++
        if (end - i > MAX_PARAM_VALUE_LEN) return false
        i = end
    }
    return true
}

function looksLikeRasterImage(buf: Buffer): boolean {
    if (buf.length < 12) return false
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true
    if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
        return true
    }
    return false
}

export function isValidAvatarDataUrl(s: string): boolean {
    if (typeof s !== "string" || s.length === 0 || s.length > MAX_AVATAR_DATA_URL_CHARS) return false
    const b64Idx = s.indexOf(";base64,")
    if (b64Idx === -1) return false
    const prefix = s.slice(0, b64Idx)
    if (!isValidAvatarMimePrefix(prefix)) return false
    const b64 = s.slice(b64Idx + 8).replace(/\s/g, "")
    if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return false
    let buf: Buffer
    try {
        buf = Buffer.from(b64, "base64")
    } catch {
        return false
    }
    if (buf.length > MAX_AVATAR_BYTES || buf.length === 0) return false
    if (!looksLikeRasterImage(buf)) return false
    return true
}
