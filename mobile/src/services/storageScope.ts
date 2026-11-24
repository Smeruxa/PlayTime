export const PRODUCTION_ORIGIN = 'https://playtime.smeruxa.ru';
const PRODUCTION_APIS = new Set(['https://smeruxa.ru/playtime', `${PRODUCTION_ORIGIN}/playtime`]);

export function environmentKey(apiBase: string | undefined, key: string): string {
    const normalized = apiBase?.trim().replace(/\/+$/, '');
    if (!normalized) {
        throw new Error('Не удалось определить сервер для защищённого хранилища');
    }
    return PRODUCTION_APIS.has(normalized)
        ? key
        : `environment:${encodeURIComponent(normalized)}:${key}`;
}
