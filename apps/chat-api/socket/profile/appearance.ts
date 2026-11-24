import { isAvatarEffectId } from "../../../shared/subscription/avatarEffects"
import { isBannerEffectId } from "../../../shared/subscription/bannerEffects"
import { isBannerStickerId } from "../../../shared/subscription/bannerStickers"
import type { PlanLimits } from "../../../shared/subscription/planCatalog"
import { visibleAvatarEffect, visibleBannerEffect } from "../../../shared/subscription/profileCustomization"
import { isValidAvatarDataUrl } from "../../utils/avatar"
import { isValidProfileBannerDataUrl } from "../../utils/profileBanner"
import type { ProfileUpdatePayload } from "./contracts"

export type ProfileAppearancePatch = {
    avatar?: string | null
    profileBanner?: string | null
    profileAvatarEffect?: string
    profileBannerEffect?: string
    profileBannerSticker?: string
}

const appearanceFields = [
    "avatar",
    "profileBanner",
    "profileAvatarEffect",
    "profileBannerEffect",
    "profileBannerSticker"
] as const

function hasField(payload: ProfileUpdatePayload, field: keyof ProfileAppearancePatch): boolean {
    return Object.prototype.hasOwnProperty.call(payload, field)
}

export function hasAppearanceFields(payload: ProfileUpdatePayload): boolean {
    return appearanceFields.some((field) => hasField(payload, field))
}

export function parseProfileAppearance(
    payload: ProfileUpdatePayload,
    limits: PlanLimits
): { patch: ProfileAppearancePatch } | { err: string } {
    const patch: ProfileAppearancePatch = {}

    if (hasField(payload, "avatar")) {
        const raw = payload.avatar
        if (raw === null || raw === "") patch.avatar = null
        else {
            if (typeof raw !== "string" || !isValidAvatarDataUrl(raw))
                return { err: "Аватар: только JPEG/PNG/WebP, не больше 25 КБ" }
            patch.avatar = raw
        }
    }

    if (hasField(payload, "profileBanner")) {
        const raw = payload.profileBanner
        if (raw === null || raw === "") patch.profileBanner = null
        else {
            if (typeof raw !== "string") return { err: "Некорректный баннер" }
            if (!limits.profileBannerAllowed) return { err: "Баннер профиля недоступен на вашем тарифе" }
            if (!isValidProfileBannerDataUrl(raw))
                return { err: "Баннер: только JPEG/PNG/WebP в base64, не больше ~200 КБ" }
            patch.profileBanner = raw
        }
    }

    if (hasField(payload, "profileAvatarEffect")) {
        const raw = payload.profileAvatarEffect
        if (typeof raw !== "string") return { err: "Некорректный эффект аватара" }
        const effect = raw.trim()
        if (!isAvatarEffectId(effect)) return { err: "Неизвестный эффект аватара" }
        if (visibleAvatarEffect(limits, effect) !== effect)
            return { err: "Этот эффект аватара доступен с тарифа Medium и выше" }
        patch.profileAvatarEffect = effect
    }

    if (hasField(payload, "profileBannerEffect")) {
        const raw = payload.profileBannerEffect
        if (typeof raw !== "string") return { err: "Некорректный эффект баннера" }
        const effect = raw.trim()
        if (!isBannerEffectId(effect)) return { err: "Неизвестный эффект баннера" }
        if (visibleBannerEffect(limits, effect) !== effect)
            return { err: "Этот эффект баннера доступен с тарифа Pro и выше" }
        patch.profileBannerEffect = effect
    }

    if (hasField(payload, "profileBannerSticker")) {
        const raw = payload.profileBannerSticker
        if (typeof raw !== "string") return { err: "Некорректный смайлик баннера" }
        const sticker = raw.trim()
        if (!isBannerStickerId(sticker)) return { err: "Неизвестный смайлик баннера" }
        if ((!limits.profileBannerAllowed || !limits.profileBannerEffectsAllowed) && sticker !== "none")
            return { err: "Смайлик на баннере доступен с тарифа Pro и выше" }
        patch.profileBannerSticker = sticker
    }

    return { patch }
}
