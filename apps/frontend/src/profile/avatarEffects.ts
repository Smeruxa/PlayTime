export const AVATAR_EFFECT_IDS = ["none", "stars", "orbit", "halo", "neon", "frost", "flare", "bloom", "prism"] as const

export type AvatarEffectId = (typeof AVATAR_EFFECT_IDS)[number]

export const AVATAR_EFFECT_OPTIONS: Array<{ id: AvatarEffectId; title: string; hint: string }> = [
    { id: "none", title: "Без эффекта", hint: "Как есть" },
    { id: "halo", title: "Ореол", hint: "Градиентное кольцо" },
    { id: "orbit", title: "Орбита", hint: "Вращающаяся дуга" },
    { id: "neon", title: "Неон", hint: "Пульсирующий контур" },
    { id: "stars", title: "Блики", hint: "Мерцающие точки" },
    { id: "frost", title: "Иней", hint: "Холодное кольцо и снежинки" },
    { id: "flare", title: "Закат", hint: "Тёплое свечение" },
    { id: "bloom", title: "Лепестки", hint: "Розовые лепестки по кругу" },
    { id: "prism", title: "Призма", hint: "Радужная дуга" }
]

export function normalizeAvatarEffect(id: string | null | undefined): AvatarEffectId {
    if (id && (AVATAR_EFFECT_IDS as readonly string[]).includes(id)) return id as AvatarEffectId
    return "none"
}
