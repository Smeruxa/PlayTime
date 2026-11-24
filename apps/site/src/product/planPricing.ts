const MONTHLY_PRICE_RUB = {
    free: 0,
    medium: 100,
    pro: 200,
    enterprise: 500,
} as const

export function getPlanMonthlyPriceRub(slug: string): number | null {
    return Object.hasOwn(MONTHLY_PRICE_RUB, slug)
        ? MONTHLY_PRICE_RUB[slug as keyof typeof MONTHLY_PRICE_RUB]
        : null
}

export function formatMonthlyPlanPrice(slug: string): string {
    const price = getPlanMonthlyPriceRub(slug)
    if (price === null) return "—"
    return price === 0 ? "Бесплатно" : `${price} ₽/мес.`
}
