import { canStartScreenShare, SCREEN_SHARE_DESKTOP_ONLY } from "../platform/screenSharing"
export { canStartScreenShare, SCREEN_SHARE_DESKTOP_ONLY } from "../platform/screenSharing"
const SCREEN_AUDIO = {
    restrictOwnAudio: true,
    suppressLocalAudioPlayback: false,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
} as MediaTrackConstraints

export async function captureScreenShare(shareAudio: boolean, sourceId?: string): Promise<MediaStream> {
    if (!canStartScreenShare()) throw new Error(SCREEN_SHARE_DESKTOP_ONLY)
    if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error(
            "Этот браузер не поддерживает демонстрацию экрана. Откройте PlayTime по HTTPS в браузере на компьютере или используйте приложение."
        )
    }
    if (sourceId) {
        if (!window.electronAPI?.selectScreenSource) throw new Error("Обновите PlayTime, чтобы передавать звук экрана.")
        await window.electronAPI.selectScreenSource(sourceId)
    }
    let stream: MediaStream
    try {
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 60 } },
            audio: shareAudio ? SCREEN_AUDIO : false,
            systemAudio: shareAudio ? "include" : "exclude",
            selfBrowserSurface: "exclude"
        } as DisplayMediaStreamOptions)
    } catch (error) {
        if (error instanceof Error && error.name === "NotAllowedError") {
            throw new Error(
                "Демонстрация не началась. Выберите экран и разрешите доступ в диалоге браузера или системы."
            )
        }
        throw error
    }
    if (shareAudio && !stream.getAudioTracks().some((track) => track.readyState === "live")) {
        stream.getTracks().forEach((track) => track.stop())
        throw new Error(
            window.electronAPI
                ? "Звук компьютера недоступен. На Mac разрешите PlayTime запись экрана и системного аудио в настройках конфиденциальности. В системном диалоге включите передачу звука. Можно также снять галочку Передавать звук компьютера и показать только изображение."
                : "Звук компьютера недоступен для выбранного источника. Попробуйте выбрать вкладку браузера и включить передачу звука в диалоге. Или отключите звук демонстрации, чтобы показать только изображение."
        )
    }
    return stream
}
