export const ATTACHMENT_MESSAGE_PLAINTEXT = "📎"

export const ATTACHMENT_MESSAGE_LIST_LABEL = "Файл"

export function formatAttachmentLimit(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        const mb = bytes / (1024 * 1024)
        return mb % 1 === 0 ? `${mb} МБ` : `${mb.toFixed(1)} МБ`
    }
    return `${Math.round(bytes / 1024)} КБ`
}
