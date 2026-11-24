export const BANNER_EFFECT_IDS = ["none", "glow", "sakura", "snow", "stars", "ember"] as const

export type BannerEffectId = (typeof BANNER_EFFECT_IDS)[number]

export function isBannerEffectId(s: string): s is BannerEffectId {
    return (BANNER_EFFECT_IDS as readonly string[]).includes(s)
}
