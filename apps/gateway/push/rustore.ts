import type { PushDelivery, PushResult } from "./types"
import { pushHttpRequest, type PushRequest } from "./httpRequest"

export type RuStorePushConfig = { projectId: string; serviceToken: string }

export function readPushConfig(): RuStorePushConfig | null {
    const projectId = process.env.RUSTORE_PUSH_PROJECT_ID?.trim()
    const serviceToken = process.env.RUSTORE_PUSH_SERVICE_TOKEN?.trim()
    return projectId && serviceToken ? { projectId, serviceToken } : null
}

export function pushMessage(delivery: PushDelivery, now: number) {
    const remaining = Math.max(1, Math.ceil((delivery.expiresAt - now) / 1000))
    const target = {
        ...delivery.target,
        eventId: delivery.eventKey,
        expiresAt: delivery.expiresAt
    }
    return {
        message: {
            token: delivery.token,
            data: {
                chat: JSON.stringify(target),
                title: delivery.title,
                kind: delivery.target.kind,
                messageId: delivery.messageId == null ? "" : String(delivery.messageId),
                eventId: delivery.eventKey,
                expiresAt: String(delivery.expiresAt)
            },
            android: { ttl: `${remaining}s` }
        }
    }
}

export class RuStorePushSender {
    constructor(
        private readonly config: RuStorePushConfig,
        private readonly request: PushRequest = pushHttpRequest
    ) {}

    async send(delivery: PushDelivery): Promise<PushResult> {
        if (delivery.expiresAt <= Date.now()) {
            return "rejected"
        }
        try {
            const response = await this.request(
                `https://vkpns-dg.rustore.ru/v1/projects/${encodeURIComponent(this.config.projectId)}/messages:send`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.config.serviceToken}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(pushMessage(delivery, Date.now())),
                    signal: AbortSignal.timeout(10_000)
                }
            )
            if (response.ok) {
                return "sent"
            }
            const body: unknown = await response.json().catch(() => null)
            const status =
                body &&
                typeof body === "object" &&
                "error" in body &&
                body.error &&
                typeof body.error === "object" &&
                "status" in body.error
                    ? body.error.status
                    : null
            if (status === "UNREGISTERED" || (response.status === 404 && status === "NOT_FOUND")) {
                return "invalid_token"
            }
            if (
                response.status === 401 ||
                response.status === 403 ||
                response.status === 429 ||
                response.status >= 500
            ) {
                return "retry"
            }
            return "rejected"
        } catch {
            return "retry"
        }
    }
}
