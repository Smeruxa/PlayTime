import type { MouseEvent } from "react"
import { FaMicrophone, FaMicrophoneSlash, FaPhoneSlash } from "react-icons/fa"
import styles from "./CallControls.module.css"
import { canStartScreenShare, SCREEN_SHARE_DESKTOP_ONLY } from "../../platform/screenSharing"

function ScreenShareIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="1em"
            height="1em"
            aria-hidden
        >
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
        </svg>
    )
}

export default function CallControls({
    mic,
    toggleMic,
    end,
    onScreenShare,
    isSharingScreen,
    screenShareDisabled = !canStartScreenShare()
}: {
    mic: boolean
    toggleMic: () => void
    end: () => void
    onScreenShare?: () => void
    isSharingScreen?: boolean
    screenShareDisabled?: boolean
}) {
    const stopSelect = (e: MouseEvent) => e.preventDefault()

    return (
        <div className={styles.interactions}>
            <button
                type="button"
                className={styles.iconWrapper}
                onMouseDown={stopSelect}
                onClick={toggleMic}
                title={mic ? "Выключить микрофон" : "Включить микрофон"}
                aria-label={mic ? "Выключить микрофон" : "Включить микрофон"}
            >
                {mic ? <FaMicrophone className={styles.icon} /> : <FaMicrophoneSlash className={styles.icon} />}
            </button>
            {onScreenShare != null && (
                <span
                    className={styles.screenControl}
                    title={screenShareDisabled ? SCREEN_SHARE_DESKTOP_ONLY : "Демонстрация экрана"}
                >
                    <button
                        type="button"
                        className={`${styles.iconWrapper} ${isSharingScreen ? styles.iconWrapperActive : ""}`}
                        onMouseDown={stopSelect}
                        onClick={onScreenShare}
                        disabled={screenShareDisabled}
                        title={screenShareDisabled ? SCREEN_SHARE_DESKTOP_ONLY : "Демонстрация экрана"}
                        aria-label="Демонстрация экрана"
                        aria-description={screenShareDisabled ? SCREEN_SHARE_DESKTOP_ONLY : undefined}
                    >
                        <ScreenShareIcon className={styles.icon} />
                    </button>
                </span>
            )}
            <button
                type="button"
                className={`${styles.iconWrapper} ${styles.endCall}`}
                onMouseDown={stopSelect}
                onClick={end}
                title="Завершить звонок"
                aria-label="Завершить звонок"
            >
                <FaPhoneSlash className={styles.icon} />
            </button>
        </div>
    )
}
