export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly verificationRequired = false,
        readonly retryAfter?: number,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export type RequestOptions = {
    method?: string;
    body?: unknown;
    auth?: boolean;
    expectedUserId?: number;
};

export async function requestJson(
    url: string,
    options: RequestOptions,
    token: string | undefined,
    fetcher: typeof fetch,
    timeoutMs: number,
): Promise<{ response: Response; body: Record<string, unknown> }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetcher(url, {
            method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'X-PlayTime-Device': 'PlayTime · Android',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        });
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        return { response, body };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('Сервер не ответил вовремя. Повторите попытку.');
        }
        throw new Error('Не удалось соединиться с сервером. Проверьте интернет и повторите.');
    } finally {
        clearTimeout(timeout);
    }
}
