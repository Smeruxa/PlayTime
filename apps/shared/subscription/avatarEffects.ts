export const AVATAR_EFFECT_IDS = ["none", "stars", "orbit", "halo", "neon", "frost", "flare", "bloom", "prism"] as const

export type AvatarEffectId = (typeof AVATAR_EFFECT_IDS)[number]

export function isAvatarEffectId(s: string): s is AvatarEffectId {
    return (AVATAR_EFFECT_IDS as readonly string[]).includes(s)
}
