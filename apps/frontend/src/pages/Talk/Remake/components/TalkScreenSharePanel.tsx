import { useEffect, useState, type RefObject } from "react"
import styles from "../Talk.module.css"
import { LOCAL_SCREEN_KEY } from "../constants"
import LocalScreenVideo from "./LocalScreenVideo"
import { FullscreenIcon } from "./TalkScreenShareIcons"
import ScreenShareVolume from "./ScreenShareVolume"
import { toggleScreenViewerFullscreen } from "../screenViewerFullscreen"

type Props = {
    screenSources: string[]
    effectiveSelected: string | null
    hasMultipleScreens: boolean
    localStream: MediaStream | null
    remoteScreens: Record<string, MediaStream>
    screenShareMuted: boolean
    screenVolume?: number
    setScreenVolume: (value: number) => void
    setScreenShareMuted: (v: boolean | ((b: boolean) => boolean)) => void
    setSelectedScreenKey: (k: string) => void
    containerRef: RefObject<HTMLDivElement | null>
    mediaRef: RefObject<HTMLVideoElement | null>
    onRequestFullscreen: () => void | Promise<void>
    electronViewerOpen?: boolean
}

export default function TalkScreenSharePanel({
    screenSources,
    effectiveSelected,
    hasMultipleScreens,
    localStream,
    remoteScreens,
    screenShareMuted,
    screenVolume = 100,
    setScreenVolume,
    setScreenShareMuted,
    setSelectedScreenKey,
    containerRef,
    mediaRef,
    onRequestFullscreen,
    electronViewerOpen = false
}: Props) {
    const [fullscreen, setFullscreen] = useState(false)
    useEffect(() => {
        const update = () => setFullscreen(document.fullscreenElement === containerRef.current)
        document.addEventListener("fullscreenchange", update)
        return () => document.removeEventListener("fullscreenchange", update)
    }, [containerRef])
    if (screenSources.length === 0) return null

    const remoteStream =
        effectiveSelected !== null && effectiveSelected !== LOCAL_SCREEN_KEY ? remoteScreens[effectiveSelected] : null

    return (
        <div className={styles.screenShareBlock}>
            <span className={styles.screenShareLabel}>
                {effectiveSelected === LOCAL_SCREEN_KEY ? "Ваша демонстрация" : `Демонстрация — ${effectiveSelected}`}
            </span>
            <div
                ref={containerRef}
                className={styles.screenShareWrap}
                onKeyDown={(event) => {
                    if (event.key === "Escape" && document.fullscreenElement === containerRef.current) {
                        void toggleScreenViewerFullscreen(containerRef.current)
                    }
                }}
            >
                <div className={styles.screenShareHoverZone}>
                    <div className={styles.screenShareMediaWrap}>
                        {effectiveSelected === LOCAL_SCREEN_KEY && localStream ? (
                            <LocalScreenVideo
                                ref={mediaRef}
                                stream={localStream}
                                className={styles.screenShareFrame}
                                isLocalPreview
                            />
                        ) : remoteStream ? (
                            <LocalScreenVideo
                                ref={mediaRef}
                                stream={remoteStream}
                                className={styles.screenShareFrame}
                                muted={screenShareMuted}
                                volume={screenVolume}
                            />
                        ) : null}
                    </div>
                    <div className={styles.screenShareOverlay}>
                        <button
                            type="button"
                            className={styles.screenShareOverlayBtn}
                            onClick={() => {
                                void onRequestFullscreen()
                            }}
                            title={electronViewerOpen || fullscreen ? "Выйти из полного экрана" : "На весь экран"}
                            aria-label={electronViewerOpen || fullscreen ? "Выйти из полного экрана" : "На весь экран"}
                        >
                            <FullscreenIcon />
                        </button>
                        {remoteStream && (
                            <ScreenShareVolume
                                volume={screenVolume}
                                muted={screenShareMuted}
                                onToggleMuted={() => setScreenShareMuted((value) => !value)}
                                onVolumeChange={setScreenVolume}
                            />
                        )}
                    </div>
                </div>
                {hasMultipleScreens && (
                    <div className={styles.screenShareSelector}>
                        {screenSources.map((key) => (
                            <button
                                type="button"
                                key={key}
                                className={`${styles.screenShareSelectorBtn} ${key === effectiveSelected ? styles.screenShareSelectorBtnActive : ""}`}
                                onClick={() => setSelectedScreenKey(key)}
                            >
                                {key === LOCAL_SCREEN_KEY ? "Вы" : key}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
