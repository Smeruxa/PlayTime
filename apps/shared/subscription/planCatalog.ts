import { AVATAR_EFFECT_IDS } from "./avatarEffects"
import { BANNER_EFFECT_IDS } from "./bannerEffects"
import { FREE_AVATAR_EFFECT_IDS, FREE_BANNER_EFFECT_IDS } from "./profileCustomization"

export type PlanSlug = "free" | "medium" | "pro" | "enterprise"

export type ScreenShareLimits = {
    targetLongSide: number
    jpegQuality: number
    remoteUiFps: number
    captureIntervalMs: number
}

export type PlanLimits = {
    maxRoomMembers: number
    maxPartySockets: number
    maxVoiceMessageSec: number
    maxScreenBroadcastFps: number
    maxAttachmentBytes: number
    screenShare: ScreenShareLimits
    profileBannerAllowed: boolean
    profileBannerEffectsAllowed: boolean
    avatarEffectsAllowed: boolean
    profileAvatarEffectIds: readonly string[]
    profileBannerEffectIds: readonly string[]
    userSummary: string
    displayName: string
}

const PLANS: Record<PlanSlug, PlanLimits> = {
    free: {
        displayName: "Free",
        userSummary:
            "Старт для личного общения: базовые лимиты комнаты, голосовых и демонстрации экрана.\n\nДве рамки аватара и лёгкий эффект баннера Тихий свет бесплатно.",
        avatarEffectsAllowed: false,
        profileBannerEffectsAllowed: false,
        profileAvatarEffectIds: FREE_AVATAR_EFFECT_IDS,
        profileBannerEffectIds: FREE_BANNER_EFFECT_IDS,
        maxRoomMembers: 5,
        maxPartySockets: 5,
        maxVoiceMessageSec: 45,
        maxScreenBroadcastFps: 10,
        maxAttachmentBytes: 512 * 1024,
        profileBannerAllowed: false,
        screenShare: {
            targetLongSide: 854,
            jpegQuality: 0.58,
            remoteUiFps: 10,
            captureIntervalMs: 1000 / 24
        }
    },
    medium: {
        displayName: "Medium",
        userSummary:
            "Небольшие команды и постоянные созвоны.\n\nБольше места в комнате, дольше голосовые, спокойнее картинка при показе экрана. Все эффекты аватара, загрузка своего баннера и Тихий свет включены.",
        avatarEffectsAllowed: true,
        profileBannerEffectsAllowed: false,
        profileAvatarEffectIds: AVATAR_EFFECT_IDS,
        profileBannerEffectIds: FREE_BANNER_EFFECT_IDS,
        maxRoomMembers: 10,
        maxPartySockets: 10,
        maxVoiceMessageSec: 90,
        maxScreenBroadcastFps: 18,
        maxAttachmentBytes: 2 * 1024 * 1024,
        profileBannerAllowed: true,
        screenShare: {
            targetLongSide: 1280,
            jpegQuality: 0.66,
            remoteUiFps: 14,
            captureIntervalMs: 1000 / 40
        }
    },
    pro: {
        displayName: "Pro",
        userSummary:
            "Плотные комнаты и важна деталь на экране.\n\nВыше лимиты участников в чате и в голосе, дольше голосовые, выше FPS при демонстрации. Эффекты и наклейки на баннер профиля. Для активных сообществ и рабочих созвонов.",
        avatarEffectsAllowed: true,
        profileBannerEffectsAllowed: true,
        profileAvatarEffectIds: AVATAR_EFFECT_IDS,
        profileBannerEffectIds: BANNER_EFFECT_IDS,
        maxRoomMembers: 25,
        maxPartySockets: 10,
        maxVoiceMessageSec: 120,
        maxScreenBroadcastFps: 35,
        maxAttachmentBytes: 5 * 1024 * 1024,
        profileBannerAllowed: true,
        screenShare: {
            targetLongSide: 1920,
            jpegQuality: 0.72,
            remoteUiFps: 18,
            captureIntervalMs: 1000 / 60
        }
    },
    enterprise: {
        displayName: "Enterprise",
        userSummary:
            "Крупные внедрения и высокие требования к нагрузке.\n\nМаксимум лимитов по комнатам, одновременному голосу, длине голосовых и плавности экрана.",
        avatarEffectsAllowed: true,
        profileBannerEffectsAllowed: true,
        profileAvatarEffectIds: AVATAR_EFFECT_IDS,
        profileBannerEffectIds: BANNER_EFFECT_IDS,
        maxRoomMembers: 100,
        maxPartySockets: 10,
        maxVoiceMessageSec: 180,
        maxScreenBroadcastFps: 60,
        maxAttachmentBytes: 10 * 1024 * 1024,
        profileBannerAllowed: true,
        screenShare: {
            targetLongSide: 1920,
            jpegQuality: 0.78,
            remoteUiFps: 24,
            captureIntervalMs: 1000 / 60
        }
    }
}

export const PLAN_SLUGS: PlanSlug[] = ["free", "medium", "pro", "enterprise"]

export function isPlanSlug(s: string): s is PlanSlug {
    return s === "free" || s === "medium" || s === "pro" || s === "enterprise"
}

export function getPlanLimits(slug: PlanSlug): PlanLimits {
    return PLANS[slug]
}

export function listPlansPublic(): Array<{ slug: PlanSlug; displayName: string; limits: PlanLimits }> {
    return PLAN_SLUGS.map((slug) => ({
        slug,
        displayName: PLANS[slug].displayName,
        limits: PLANS[slug]
    }))
}
