export function passwordPolicyError(password: unknown): string | null {
    if (typeof password !== "string" || password.length < 12 || password.length > 50)
        return "Пароль должен содержать от 12 до 50 символов"
    if (new TextEncoder().encode(password).length > 72)
        return "Пароль должен занимать не больше 72 байт: сократите символы кириллицы или эмодзи"
    return null
}
export function normalizeEmail(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : ""
}
