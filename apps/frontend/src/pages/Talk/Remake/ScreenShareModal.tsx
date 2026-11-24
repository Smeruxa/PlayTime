import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import styles from "./Talk.module.css"
import { captureScreenShare, canStartScreenShare, SCREEN_SHARE_DESKTOP_ONLY } from "../../../webrtc/screenCapture"
import { Checkbox } from "../../../ui/primitives/Checkbox"
import { Modal } from "../../../ui/overlays/Modal"
import { Button } from "../../../ui/primitives/Button"

type Source = { id: string; name: string; thumbnail: string }

function ScreenShareModalSkeleton() {
    return (
        <div className={styles.screenShareModalSkeleton} aria-hidden>
            {[0, 1, 2, 3].map((i) => (
                <div key={i} className={styles.screenShareModalSkeletonCard}>
                    <div className={styles.screenShareModalSkeletonThumb} />
                    <div className={styles.screenShareModalSkeletonLabel} />
                </div>
            ))}
        </div>
    )
}

export default function ScreenShareModal({
    onSelect,
    onClose
}: {
    onSelect: (stream: MediaStream) => void
    onClose: () => void
}) {
    const [sources, setSources] = useState<Source[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [shareAudio, setShareAudio] = useState(true)
    const [picking, setPicking] = useState(false)
    const mountedRef = useRef(true)

    const hasNativePicker = !window.electronAPI?.getScreenSources
    const screenCaptureSupported = typeof navigator.mediaDevices?.getDisplayMedia === "function"

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    useEffect(() => {
        if (!hasNativePicker) {
            window.electronAPI!.getScreenSources!()
                .then(setSources)
                .catch((e) => setError(e?.message ?? "Не удалось загрузить список экранов"))
                .finally(() => setLoading(false))
        } else {
            setLoading(false)
        }
    }, [hasNativePicker])

    useEffect(() => {
        if (hasNativePicker) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [onClose, hasNativePicker])

    const pick = async (sourceId?: string) => {
        setError(null)
        setPicking(true)
        try {
            const stream = await captureScreenShare(shareAudio, sourceId)
            if (!mountedRef.current) {
                stream.getTracks().forEach((track) => track.stop())
                return
            }
            onSelect(stream)
        } catch (e: any) {
            if (mountedRef.current) setError(e?.message ?? "Не удалось захватить экран")
        } finally {
            if (mountedRef.current) setPicking(false)
        }
    }

    if (!canStartScreenShare())
        return (
            <Modal title="Демонстрация экрана" onClose={onClose} footer={<Button onClick={onClose}>Понятно</Button>}>
                <p className={styles.screenShareModalHint}>{SCREEN_SHARE_DESKTOP_ONLY}</p>
            </Modal>
        )

    if (hasNativePicker)
        return (
            <Modal
                title="Демонстрация экрана"
                onClose={onClose}
                footer={
                    <Button disabled={picking || !screenCaptureSupported} onClick={() => void pick()}>
                        {picking ? "Выбираем источник…" : "Выбрать экран"}
                    </Button>
                }
            >
                <div className={styles.browserScreenOptions}>
                    {error && (
                        <p role="alert" className={styles.screenShareModalError}>
                            {error}
                        </p>
                    )}
                    <Checkbox
                        checked={shareAudio}
                        disabled={picking || !screenCaptureSupported}
                        onCheckedChange={setShareAudio}
                    >
                        Передавать звук демонстрации
                    </Checkbox>
                    <p className={styles.screenShareModalHint}>
                        {screenCaptureSupported
                            ? "Выберите вкладку, окно или экран в диалоге браузера. Передача звука зависит от браузера и выбранного источника."
                            : "Демонстрация экрана недоступна в этом браузере. Используйте браузер на компьютере или приложение PlayTime."}
                    </p>
                </div>
            </Modal>
        )

    return createPortal(
        <div className={styles.screenShareModalBackdrop} onClick={onClose} role="presentation">
            <div
                className={`${styles.screenShareModal} ${styles.screenShareModalEnter}`}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="screen-share-modal-title"
            >
                <div className={styles.screenShareModalHeader}>
                    <span id="screen-share-modal-title" className={styles.volumeModalTitle}>
                        Демонстрация экрана
                    </span>
                    <button
                        type="button"
                        className={styles.screenShareModalClose}
                        onClick={onClose}
                        aria-label="Закрыть"
                    >
                        ×
                    </button>
                </div>
                {loading ? <ScreenShareModalSkeleton /> : null}
                {error && (
                    <p role="alert" className={styles.screenShareModalError}>
                        {error}
                    </p>
                )}
                <Checkbox
                    className={styles.screenShareModalHint}
                    checked={shareAudio}
                    disabled={picking}
                    onCheckedChange={setShareAudio}
                >
                    Передавать звук компьютера
                </Checkbox>
                {!loading && sources.length > 0 && (
                    <>
                        <div className={`${styles.screenShareSources} ${styles.screenShareSourcesEnter}`}>
                            {sources.map((s) => (
                                <button
                                    type="button"
                                    key={s.id}
                                    className={styles.screenShareSourceCard}
                                    disabled={picking}
                                    onClick={() => void pick(s.id)}
                                >
                                    <img src={s.thumbnail} alt="" className={styles.screenShareThumb} />
                                    <span className={styles.screenShareSourceName}>{s.name}</span>
                                </button>
                            ))}
                        </div>
                    </>
                )}
                {!loading && sources.length === 0 && !error && (
                    <p className={styles.screenShareModalHint}>
                        Экраны недоступны. Проверьте разрешение PlayTime на запись экрана в настройках
                        конфиденциальности и откройте выбор экрана снова.
                    </p>
                )}
            </div>
        </div>,
        document.body
    )
}
