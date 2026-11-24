import type { PushDelivery, PushResult } from "./types"

export type PushQueue = {
    claim: () => Promise<PushDelivery[]>
    allowed: (delivery: PushDelivery) => Promise<boolean>
    complete: (id: string) => Promise<void>
    invalidate: (deviceId: string, token: string) => Promise<void>
    retry: (id: string, delaySeconds: number) => Promise<void>
}

export class PushDispatcher {
    private running = false

    constructor(
        private readonly queue: PushQueue,
        private readonly sender: { send: (delivery: PushDelivery) => Promise<PushResult> },
        private readonly now: () => number = Date.now
    ) {}

    async flush(): Promise<void> {
        if (this.running) {
            return
        }
        this.running = true
        try {
            for (const delivery of await this.queue.claim()) {
                await this.deliver(delivery)
            }
        } finally {
            this.running = false
        }
    }

    private async deliver(delivery: PushDelivery): Promise<void> {
        if (delivery.expiresAt <= this.now() || !(await this.queue.allowed(delivery))) {
            await this.queue.complete(delivery.id)
            return
        }
        const result = await this.sender.send(delivery)
        if (result === "invalid_token") {
            await this.queue.invalidate(delivery.deviceId, delivery.token)
            await this.queue.complete(delivery.id)
        } else if (result === "retry" && delivery.attempts < 8) {
            await this.queue.retry(delivery.id, Math.min(900, 5 * 2 ** delivery.attempts))
        } else {
            await this.queue.complete(delivery.id)
        }
    }
}
