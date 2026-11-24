import { readBillingProfile } from "../../shared/subscription/billingScope"
import type { BillingConfig } from "./types"

export function readBillingConfig(env: Record<string, string | undefined> = process.env): BillingConfig | null {
    return readBillingProfile(env, process.env.SITE_PUBLIC_PATH)
}
