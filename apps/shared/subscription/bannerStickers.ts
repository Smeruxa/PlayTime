export const BANNER_STICKER_IDS = [
    "none",
    "grin",
    "heart_eyes",
    "star_struck",
    "cool",
    "joy",
    "fire",
    "sparkles",
    "hundred",
    "rocket",
    "rainbow",
    "moon",
    "sun",
    "cherry",
    "cat",
    "party",
    "ghost"
] as const

export type BannerStickerId = (typeof BANNER_STICKER_IDS)[number]

export function isBannerStickerId(s: string): s is BannerStickerId {
    return (BANNER_STICKER_IDS as readonly string[]).includes(s)
}
