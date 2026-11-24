import { publicAssetUrl } from "../utils/publicAssetUrl"

export const OPEN_CONTENT_EVENT = "playtime:open-content"
export type NotificationTarget = {
    name: string
    peerUserId?: number
    isRoom?: boolean
    roomId?: number
    roomName?: string
}
export type BrowserNotificationPermission = NotificationPermission | "unsupported"

export function browserNotificationPermission(): BrowserNotificationPermission {
    return typeof Notification === "undefined" || !window.isSecureContext ? "unsupported" : Notification.permission
}

export async function requestBrowserNotifications(): Promise<BrowserNotificationPermission> {
    const permission = browserNotificationPermission()
    if (permission !== "default") return permission
    try {
        return await Notification.requestPermission()
    } catch {
        return browserNotificationPermission()
    }
}

export function notifyMessage(data: NotificationTarget & { text: string }): void {
    if (window.electronAPI?.sendNotification) {
        window.electronAPI.sendNotification(data)
        return
    }
    if (browserNotificationPermission() !== "granted") return
    try {
        const notification = new Notification(data.name, {
            body: data.text,
            icon: publicAssetUrl("assets/PlayTime.png"),
            tag: data.isRoom ? `playtime-room-${data.roomId}` : `playtime-dm-${data.peerUserId ?? "unknown"}`
        })
        notification.onclick = () => {
            window.focus()
            window.dispatchEvent(new CustomEvent<NotificationTarget>(OPEN_CONTENT_EVENT, { detail: data }))
            notification.close()
        }
    } catch {
    }
}
