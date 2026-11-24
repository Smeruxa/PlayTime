export type BillingScope = {
    mode: "test" | "live"
    shopId: string
}

export type BillingProfile = BillingScope & { secretKey: string; returnUrl: string }

export function readBillingProfile(
    env: Record<string, string | undefined>,
    sitePublicPath: string | undefined
): BillingProfile | null {
    const mode = env.YOOKASSA_MODE
    const shopId = env.YOOKASSA_SHOP_ID?.trim()
    const secretKey = env.YOOKASSA_SECRET_KEY?.trim()
    if (
        (mode !== "test" && mode !== "live") ||
        !shopId ||
        !/^\d{1,32}$/.test(shopId) ||
        !secretKey ||
        !secretKey.startsWith(`${mode}_`) ||
        secretKey.length <= 5 ||
        secretKey.length > 512 ||
        /\s/.test(secretKey)
    )
        return null
    try {
        const origin = new URL(env.SITE_ORIGIN || "")
        const local =
            mode === "test" &&
            env.NODE_ENV !== "production" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
        if (
            (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) ||
            origin.username ||
            origin.password ||
            origin.pathname !== "/" ||
            origin.search ||
            origin.hash
        )
            return null
        const path = (sitePublicPath?.trim() || "/playtime").replace(/\/$/, "")
        const publicPath = path.startsWith("/") ? path : `/${path}`
        return { mode, shopId, secretKey, returnUrl: new URL(`${publicPath}/checkout`, origin).href }
    } catch {
        return null
    }
}

export function readBillingScope(env: Record<string, string | undefined> = process.env): BillingScope | null {
    if (env.PLAYTIME_BILLING_SCOPE_ONLY === "1") {
        const mode = env.YOOKASSA_MODE
        const shopId = env.YOOKASSA_SHOP_ID?.trim()
        return (mode === "test" || mode === "live") && shopId && /^\d{1,32}$/.test(shopId) ? { mode, shopId } : null
    }
    const profile = readBillingProfile(env, env.SITE_PUBLIC_PATH)
    return profile ? { mode: profile.mode, shopId: profile.shopId } : null
}
