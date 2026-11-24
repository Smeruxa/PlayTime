export const SCREEN_SHARE_DESKTOP_ONLY = "Демонстрация экрана доступна в приложении PlayTime."
export const canStartScreenShare = () => !!(window as Window & { electronAPI?: unknown }).electronAPI
