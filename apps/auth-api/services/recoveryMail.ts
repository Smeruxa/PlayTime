import nodemailer from "nodemailer"

export function isRecoveryMailConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim())
}

export async function sendRecoveryMail(
    email: string,
    code: string,
    purpose: "recovery" | "verification" | "session-revocation" = "recovery",
    deviceName?: string
): Promise<void> {
    if (!isRecoveryMailConfigured()) throw new Error("Recovery mail is not configured")
    const port = Number(process.env.SMTP_PORT || 587)
    const secure = port === 465
    const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure,
        requireTLS: process.env.NODE_ENV === "production" && !secure,
        tls: process.env.SMTP_TLS_SERVERNAME?.trim()
            ? { servername: process.env.SMTP_TLS_SERVERNAME.trim() }
            : undefined,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
        connectionTimeout: 10_000,
        socketTimeout: 15_000,
        disableFileAccess: true,
        disableUrlAccess: true
    })
    await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: email,
        subject:
            purpose === "session-revocation"
                ? "Подтверждение отключения устройства PlayTime"
                : purpose === "verification"
                  ? "Подтверждение почты PlayTime"
                  : "Восстановление доступа к PlayTime",
        text:
            purpose === "session-revocation"
                ? `Код подтверждения: ${code}\n\nВы запросили завершение сеанса: ${(deviceName || "все остальные устройства").replace(/[\r\n]/g, " ").slice(0, 160)}.\n\nВведите код в приложении PlayTime. Код действует 10 минут и используется один раз только для этого действия. Если это были не вы, не вводите и никому не сообщайте код.`
                : purpose === "verification"
                  ? `Код подтверждения почты: ${code}\n\nВведите его в приложении PlayTime. Код действует 15 минут и используется один раз. Если вы не регистрировались, проигнорируйте это письмо. Никому не сообщайте код.`
                  : `Код восстановления: ${code}\n\nВведите его в приложении PlayTime в разделе Забыли пароль?. Код действует 15 минут и используется один раз.\n\nЕсли вы не запрашивали восстановление, проигнорируйте письмо. Никому не сообщайте код. Сброс пароля аккаунта не восстанавливает ключи зашифрованной переписки.`
    })
}
