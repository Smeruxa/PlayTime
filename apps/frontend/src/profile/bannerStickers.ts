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

export const BANNER_STICKER_OPTIONS: Array<{
    id: BannerStickerId
    title: string
    hint: string
    char: string
}> = [
    { id: "none", title: "Нет", hint: "Без смайлика", char: "" },
    { id: "grin", title: "Улыбка", hint: "Весёлый", char: "😁" },
    { id: "heart_eyes", title: "Влюблён", hint: "Сердечки", char: "😍" },
    { id: "star_struck", title: "Звёзды", hint: "Wow", char: "🤩" },
    { id: "cool", title: "Крутой", hint: "В очках", char: "😎" },
    { id: "joy", title: "Смех", hint: "До слёз", char: "😂" },
    { id: "fire", title: "Огонь", hint: "Жарко", char: "🔥" },
    { id: "sparkles", title: "Блеск", hint: "Сияние", char: "✨" },
    { id: "hundred", title: "Сотка", hint: "Идеально", char: "💯" },
    { id: "rocket", title: "Ракета", hint: "Вперёд", char: "🚀" },
    { id: "rainbow", title: "Радуга", hint: "Ярко", char: "🌈" },
    { id: "moon", title: "Луна", hint: "Ночь", char: "🌙" },
    { id: "sun", title: "Солнце", hint: "День", char: "☀️" },
    { id: "cherry", title: "Вишня", hint: "Сладко", char: "🍒" },
    { id: "cat", title: "Кот", hint: "Мяу", char: "🐱" },
    { id: "party", title: "Праздник", hint: "Туса", char: "🎉" },
    { id: "ghost", title: "Призрак", hint: "Бу!", char: "👻" }
]

const CHAR_BY_ID: Record<string, string> = Object.fromEntries(
    BANNER_STICKER_OPTIONS.map((o) => [o.id, o.char])
)

export function bannerStickerChar(id: string): string {
    return CHAR_BY_ID[id] ?? ""
}
