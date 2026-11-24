export const BANNER_EFFECT_IDS = ["none", "glow", "sakura", "snow", "stars", "ember"] as const

export type BannerEffectId = (typeof BANNER_EFFECT_IDS)[number]

export const BANNER_EFFECT_OPTIONS: Array<{ id: BannerEffectId; title: string; hint: string }> = [
    { id: "none", title: "Без эффекта", hint: "Без движения" },
    { id: "glow", title: "Тихий свет", hint: "Едва заметное дыхание света. Бесплатно." },
    { id: "sakura", title: "Сакура", hint: "Падающие лепестки вишни" },
    { id: "snow", title: "Снегопад", hint: "Медленно падающие снежинки" },
    { id: "stars", title: "Светлячки", hint: "Мерцающие огоньки в сумерках" },
    { id: "ember", title: "Искры", hint: "Восходящие угольки и тепло" }
]

export function normalizeBannerEffect(id: string | null | undefined): BannerEffectId {
    if (id && (BANNER_EFFECT_IDS as readonly string[]).includes(id)) return id as BannerEffectId
    return "none"
}
