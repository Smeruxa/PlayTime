import { AVATAR_EFFECT_IDS } from "./avatarEffects"
import { BANNER_EFFECT_IDS } from "./bannerEffects"

export const FREE_AVATAR_EFFECT_IDS = ["none", "halo", "orbit"] as const
export const FREE_BANNER_EFFECT_IDS = ["none", "glow"] as const

export type ProfileCustomizationLimits = {
    avatarEffectsAllowed?: boolean
    profileBannerEffectsAllowed?: boolean
    profileAvatarEffectIds?: readonly string[]
    profileBannerEffectIds?: readonly string[]
}

export function allowedAvatarEffects(limits: ProfileCustomizationLimits | null | undefined): readonly string[] {
    const ids = limits?.profileAvatarEffectIds
    return AVATAR_EFFECT_IDS.filter((id) => id === "none" || (ids ? ids.includes(id) : limits?.avatarEffectsAllowed))
}

export function allowedBannerEffects(limits: ProfileCustomizationLimits | null | undefined): readonly string[] {
    const ids = limits?.profileBannerEffectIds
    return BANNER_EFFECT_IDS.filter(
        (id) => id === "none" || (ids ? ids.includes(id) : limits?.profileBannerEffectsAllowed)
    )
}

export function visibleAvatarEffect(
    limits: ProfileCustomizationLimits | null | undefined,
    value: string | null | undefined
): string {
    return value && allowedAvatarEffects(limits).includes(value) ? value : "none"
}

export function visibleBannerEffect(
    limits: ProfileCustomizationLimits | null | undefined,
    value: string | null | undefined
): string {
    return value && allowedBannerEffects(limits).includes(value) ? value : "none"
}
