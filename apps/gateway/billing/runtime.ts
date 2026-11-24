import { pool } from "../../shared/config"
import { readBillingConfig } from "./config"
import { BillingService } from "./orderService"
import { YooKassaProvider } from "./yookassa"

let onGrant: ((userId: number) => Promise<void> | void) | undefined
export const billingService = new BillingService({
    pool,
    config: readBillingConfig,
    provider: (config) => new YooKassaProvider(config),
    onGrant: (userId) => onGrant?.(userId)
})

export function setBillingGrantListener(listener: (userId: number) => Promise<void> | void): void {
    onGrant = listener
}
