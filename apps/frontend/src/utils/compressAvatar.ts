const MAX_BYTES = 25 * 1024

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(new Error("read"))
        r.readAsDataURL(blob)
    })
}

export async function compressAvatarToDataUrl(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file)
    try {
        let maxSide = 480
        for (let shrink = 0; shrink < 18; shrink++) {
            for (let qStep = 0; qStep < 28; qStep++) {
                const quality = 0.9 * Math.pow(0.86, qStep)
                const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
                const w = Math.max(1, Math.round(bitmap.width * scale))
                const h = Math.max(1, Math.round(bitmap.height * scale))
                const canvas = document.createElement("canvas")
                canvas.width = w
                canvas.height = h
                const ctx = canvas.getContext("2d")
                if (!ctx) throw new Error("canvas")
                ctx.drawImage(bitmap, 0, 0, w, h)

                for (const mime of ["image/jpeg", "image/webp"] as const) {
                    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, quality))
                    if (blob && blob.size > 0 && blob.size <= MAX_BYTES) return blobToDataUrl(blob)
                }
            }
            maxSide = Math.floor(maxSide * 0.78)
            if (maxSide < 40) break
        }
    } finally {
        bitmap.close()
    }
    throw new Error("Не удалось уменьшить аватар до 25 КБ")
}

const BANNER_MAX_BYTES = 195 * 1024

export async function compressProfileBannerToDataUrl(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file)
    try {
        let maxSide = 1920
        for (let shrink = 0; shrink < 22; shrink++) {
            for (let qStep = 0; qStep < 32; qStep++) {
                const quality = 0.88 * Math.pow(0.9, qStep)
                const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
                const w = Math.max(1, Math.round(bitmap.width * scale))
                const h = Math.max(1, Math.round(bitmap.height * scale))
                const canvas = document.createElement("canvas")
                canvas.width = w
                canvas.height = h
                const ctx = canvas.getContext("2d")
                if (!ctx) throw new Error("canvas")
                ctx.drawImage(bitmap, 0, 0, w, h)

                for (const mime of ["image/jpeg", "image/webp"] as const) {
                    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, quality))
                    if (blob && blob.size > 0 && blob.size <= BANNER_MAX_BYTES) return blobToDataUrl(blob)
                }
            }
            maxSide = Math.floor(maxSide * 0.82)
            if (maxSide < 480) break
        }
    } finally {
        bitmap.close()
    }
    throw new Error("Не удалось уменьшить баннер до допустимого размера")
}

const DM_WALLPAPER_MAX_BYTES = 320 * 1024

export async function compressDmWallpaperToDataUrl(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file)
    try {
        let maxSide = 1280
        for (let shrink = 0; shrink < 20; shrink++) {
            for (let qStep = 0; qStep < 28; qStep++) {
                const quality = 0.86 * Math.pow(0.9, qStep)
                const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
                const w = Math.max(1, Math.round(bitmap.width * scale))
                const h = Math.max(1, Math.round(bitmap.height * scale))
                const canvas = document.createElement("canvas")
                canvas.width = w
                canvas.height = h
                const ctx = canvas.getContext("2d")
                if (!ctx) throw new Error("canvas")
                ctx.drawImage(bitmap, 0, 0, w, h)

                for (const mime of ["image/jpeg", "image/webp"] as const) {
                    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, quality))
                    if (blob && blob.size > 0 && blob.size <= DM_WALLPAPER_MAX_BYTES) return blobToDataUrl(blob)
                }
            }
            maxSide = Math.floor(maxSide * 0.82)
            if (maxSide < 400) break
        }
    } finally {
        bitmap.close()
    }
    throw new Error("Не удалось сжать обои до допустимого размера")
}

export function formatProfileDate(iso: string) {
    try {
        const d = new Date(iso)
        return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    } catch {
        return ""
    }
}
