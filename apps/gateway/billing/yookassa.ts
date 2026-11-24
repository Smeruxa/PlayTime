import type { BillingConfig, PaymentProvider, PaymentRequest } from "./types"
import { UUID } from "./validation"

export class YooKassaProvider implements PaymentProvider {
    constructor(
        private readonly config: BillingConfig,
        private readonly fetcher: typeof fetch = fetch
    ) {}

    create(request: PaymentRequest, idempotenceKey: string): Promise<unknown> {
        return this.request("/payments", {
            method: "POST",
            headers: { "Idempotence-Key": idempotenceKey },
            body: JSON.stringify(request)
        })
    }

    get(paymentId: string): Promise<unknown> {
        if (!UUID.test(paymentId)) return Promise.reject(new Error("Invalid provider payment ID"))
        return this.request(`/payments/${paymentId}`, { method: "GET" })
    }

    private async request(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<unknown> {
        const response = await this.fetcher(`https://api.yookassa.ru/v3${path}`, {
            ...init,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${Buffer.from(`${this.config.shopId}:${this.config.secretKey}`).toString("base64")}`,
                ...init.headers
            },
            signal: AbortSignal.timeout(8000),
            redirect: "error"
        })
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json") || !response.body)
            throw new Error("Payment provider unavailable")
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        for (let part = await reader.read(); !part.done; part = await reader.read()) {
            size += part.value.byteLength
            if (size > 65536) {
                await reader.cancel()
                throw new Error("Payment provider response exceeded limit")
            }
            chunks.push(part.value)
        }
        try {
            return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
        } catch {
            throw new Error("Invalid payment provider response")
        }
    }
}
