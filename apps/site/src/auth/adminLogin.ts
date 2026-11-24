export class AdminAccessError extends Error {
    readonly reason: "unauthenticated" | "denied" | "unavailable"
    constructor(reason: "unauthenticated" | "denied" | "unavailable", message: string) {
        super(message)
        this.reason = reason
    }
}

export async function checkAdminAccess(
    apiBase: string,
    signal: AbortSignal,
    request: typeof fetch = fetch
) {
    const response = await request(`${apiBase}/admin/access`, {
        signal,
        cache: "no-store",
        credentials: "same-origin",
    })
    if (response.status === 401)
        throw new AdminAccessError("unauthenticated", "Доступ к панели ограничен.")
    if (response.status === 403)
        throw new AdminAccessError("denied", "Откройте панель на основном сайте PlayTime.")
    if (!response.ok)
        throw new AdminAccessError(
            "unavailable",
            "Сервер недоступен. Повторите проверку подключения."
        )
    const body = (await response.json()) as { allowed?: boolean; clientIp?: string }
    if (body.allowed !== true) throw new AdminAccessError("denied", "Доступ к панели не разрешён.")
    return { clientIp: body.clientIp ?? "" }
}

export function createAdminLoginCommand(apiBase: string, panelPath: string) {
    return `(async () => {
  const endpoint = new URL(${JSON.stringify(`${apiBase}/admin/session`)}, location.origin);
  if (endpoint.origin !== location.origin) throw new Error("Откройте панель на основном сайте PlayTime.");
  const key = prompt("Ключ администратора PlayTime");
  if (!key) return;
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-PlayTime-Admin": "1" },
    body: JSON.stringify({ key })
  });
  if (!response.ok) {
    const minutes = Math.max(1, Math.ceil((Number(response.headers.get("Retry-After")) || 1800) / 60));
    throw new Error(response.status === 401 ? "Ключ не подошёл. Повторный вход с этого IP будет доступен через 30 минут." : response.status === 429 ? "Повторите вход через " + minutes + " мин." : response.status === 503 ? "Вход временно недоступен. Повторите позже." : "Не удалось открыть сессию администратора.");
  }
  location.assign(${JSON.stringify(panelPath)});
})();`
}

export async function endAdminSession(apiBase: string, request: typeof fetch = fetch) {
    const response = await request(`${apiBase}/admin/session`, {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "X-PlayTime-Admin": "1" },
    })
    if (!response.ok && response.status !== 401)
        throw new Error("Не удалось завершить сессию. Повторите выход.")
}
