import type { PlanLimitsWire } from "../../types/subscription"
import { allowedAvatarEffects, allowedBannerEffects } from "../../../../shared/subscription/profileCustomization"

export const PLAN_DISPLAY: Record<string, string> = {
    free: "Free",
    medium: "Medium",
    pro: "Pro",
    enterprise: "Enterprise"
}

export type PlanHighlight = {
    label: string
    value: string
}

export function getPlanHighlights(_planSlug: string | null, limits: PlanLimitsWire | null): PlanHighlight[] {
    if (!limits) return []
    const items: PlanHighlight[] = [
        { label: "Участники комнаты", value: `до ${limits.maxRoomMembers}` },
        { label: "Голосовые", value: `до ${limits.maxVoiceMessageSec} с` },
        { label: "Экран", value: `до ${limits.maxScreenBroadcastFps} FPS` }
    ]
    if (limits.profileBannerAllowed) {
        items.push({ label: "Баннер профиля", value: "включён" })
    }
    if (allowedAvatarEffects(limits).length > 1) {
        items.push({ label: "Эффекты аватара", value: String(allowedAvatarEffects(limits).length - 1) })
    }
    if (allowedBannerEffects(limits).length > 1) {
        items.push({ label: "Эффекты баннера", value: String(allowedBannerEffects(limits).length - 1) })
    }
    return items
}

export function getPlanTagline(planSlug: string | null): string {
    switch (planSlug) {
        case "free":
            return "Базовый набор для личного общения и небольших созвонов."
        case "medium":
            return "Расширенные лимиты и оформление профиля для регулярных команд."
        case "pro":
            return "Максимум возможностей для активных сообществ и демонстрации экрана."
        case "enterprise":
            return "Повышенные лимиты для корпоративного использования."
        default:
            return "Текущие возможности аккаунта."
    }
}
