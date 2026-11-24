export function microphoneError(error: unknown): string {
    if (!navigator.mediaDevices?.getUserMedia) {
        return "Микрофон недоступен. Откройте PlayTime по HTTPS в современном браузере."
    }
    const name = error instanceof Error ? error.name : ""
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        return "Разрешите доступ к микрофону в настройках сайта и попробуйте снова."
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        return "Микрофон не найден. Подключите его и попробуйте снова."
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
        return "Не удалось включить микрофон. Проверьте, не занят ли он другим приложением."
    }
    return "Не удалось включить микрофон. Проверьте разрешения браузера и попробуйте снова."
}
