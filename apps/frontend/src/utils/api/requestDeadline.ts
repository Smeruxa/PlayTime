export const AUTH_REQUEST_TIMEOUT_MS = 12_000
export const AUTH_LOCK_TIMEOUT_MS = 5_000

export class RequestTimeoutError extends Error {
    constructor() {
        super("Сервер не ответил вовремя. Проверьте соединение и повторите попытку.")
        this.name = "RequestTimeoutError"
    }
}

export async function withRequestDeadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
    parentSignal?: AbortSignal
): Promise<T> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancel!: () => void
    const cancelled = new Promise<never>((_resolve, reject) => {
        cancel = () => {
            controller.abort()
            reject(
                parentSignal?.aborted ? new DOMException("Request cancelled", "AbortError") : new RequestTimeoutError()
            )
        }
        timer = setTimeout(cancel, timeoutMs)
        parentSignal?.addEventListener("abort", cancel, { once: true })
    })
    try {
        if (parentSignal?.aborted) cancel()
        return await Promise.race([
            cancelled,
            controller.signal.aborted ? Promise.reject(controller.signal.reason) : operation(controller.signal)
        ])
    } finally {
        clearTimeout(timer)
        parentSignal?.removeEventListener("abort", cancel)
    }
}

export function randomRequestKey(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function fetchAuthJson(url: string, init: RequestInit) {
    return withRequestDeadline(
        async (signal) => {
            const response = await fetch(url, { ...init, signal })
            const body = await response.json()
            signal.throwIfAborted()
            return { response, body }
        },
        undefined,
        init.signal ?? undefined
    )
}
