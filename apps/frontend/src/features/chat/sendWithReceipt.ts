import type { Socket } from "socket.io-client"

type SendResponse = { success?: true; id?: number; duplicate?: boolean; err?: string }
export type SendReceipt = { success: true; id: number; duplicate?: boolean }

export class MessageSendError extends Error {
    constructor(
        message: string,
        public readonly retryable: boolean
    ) {
        super(message)
    }
}

export async function sendWithReceipt(
    socket: Socket,
    payload: Record<string, unknown>,
    onRetry: () => void,
    signal?: AbortSignal
): Promise<SendReceipt> {
    for (let attempt = 0; attempt < 3; attempt++) {
        signal?.throwIfAborted()
        if (!socket.connected)
            throw new MessageSendError("Нет соединения. Отправка продолжится после подключения.", true)
        let receipt: SendResponse
        try {
            receipt = await socket.timeout(8000).emitWithAck("message:send", payload)
        } catch {
            signal?.throwIfAborted()
            if (attempt === 2)
                throw new MessageSendError("Подтверждение не получено. Повторите отправку — дубль не появится.", true)
            onRetry()
            continue
        }
        signal?.throwIfAborted()
        if (
            !receipt?.success ||
            typeof receipt.id !== "number" ||
            !Number.isSafeInteger(receipt.id) ||
            receipt.id <= 0
        ) {
            throw new MessageSendError(receipt?.err || "Сообщение не сохранено", false)
        }
        return { success: true, id: receipt.id, duplicate: receipt.duplicate }
    }
    throw new Error("Подтверждение не получено")
}
