import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import styles from "../../../ui/chat/ComposerShell.module.css"

export type VoiceNoteVariant = "mine" | "other" | "composer"

function formatClock(sec: number): string {
    if (!Number.isFinite(sec) || sec < 0) return "0:00"
    const s = Math.floor(sec)
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${r.toString().padStart(2, "0")}`
}

export function VoiceMicGlyph({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden width="22" height="22">
            <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.75" />
            <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <path d="M12 18v3M8 21h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
    )
}

function VoicePlayGlyph({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden width="20" height="20">
            <path fill="currentColor" d="M8 5v14l11-7z" />
        </svg>
    )
}

function VoicePauseGlyph({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden width="20" height="20">
            <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
        </svg>
    )
}

type VoiceNoteShellProps = {
    src: string | null
    durationHintSec?: number
    variant: VoiceNoteVariant
    pending?: boolean
    error?: boolean
}

export function VoiceNoteShell({ src, durationHintSec = 0, variant, pending = false, error = false }: VoiceNoteShellProps) {
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [playing, setPlaying] = useState(false)
    const [current, setCurrent] = useState(0)
    const [mediaDur, setMediaDur] = useState(0)

    const total = Math.max(
        Number.isFinite(mediaDur) && mediaDur > 0 ? mediaDur : 0,
        Number.isFinite(durationHintSec) && durationHintSec > 0 ? durationHintSec : 0
    )

    useEffect(() => {
        const a = audioRef.current
        if (!a || !src) {
            setPlaying(false)
            setCurrent(0)
            setMediaDur(0)
            return
        }
        a.pause()
        a.src = src
        setPlaying(false)
        setCurrent(0)
        void a.load()

        const onMeta = () => {
            if (Number.isFinite(a.duration) && a.duration > 0) setMediaDur(a.duration)
        }
        const onTime = () => setCurrent(a.currentTime)
        const onEnded = () => {
            setPlaying(false)
            setCurrent(0)
            try {
                a.currentTime = 0
            } catch {
            }
        }
        const onPlay = () => setPlaying(true)
        const onPause = () => setPlaying(false)

        a.addEventListener("loadedmetadata", onMeta)
        a.addEventListener("durationchange", onMeta)
        a.addEventListener("timeupdate", onTime)
        a.addEventListener("ended", onEnded)
        a.addEventListener("play", onPlay)
        a.addEventListener("pause", onPause)
        return () => {
            a.removeEventListener("loadedmetadata", onMeta)
            a.removeEventListener("durationchange", onMeta)
            a.removeEventListener("timeupdate", onTime)
            a.removeEventListener("ended", onEnded)
            a.removeEventListener("play", onPlay)
            a.removeEventListener("pause", onPause)
            a.pause()
            a.removeAttribute("src")
            void a.load()
        }
    }, [src])

    const progressBase = Math.max(total, 0.001)
    const pct = Math.min(100, Math.max(0, (current / progressBase) * 100))
    const shownEndSec = Math.max(total, durationHintSec)

    const toggle = useCallback(() => {
        const a = audioRef.current
        if (!a || !src) return
        if (a.paused) void a.play().catch(() => setPlaying(false))
        else a.pause()
    }, [src])

    const seekableDuration = useCallback(() => {
        const a = audioRef.current
        if (a && Number.isFinite(a.duration) && a.duration > 0) return a.duration
        return Math.max(total, durationHintSec, 0.001)
    }, [total, durationHintSec])

    const onSeek = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            const a = audioRef.current
            if (!a || !src) return
            const len = seekableDuration()
            const rect = e.currentTarget.getBoundingClientRect()
            const x = e.clientX - rect.left
            const p = Math.max(0, Math.min(1, x / rect.width))
            a.currentTime = p * len
            setCurrent(a.currentTime)
        },
        [src, seekableDuration]
    )

    const wrapClass =
        variant === "mine"
            ? `${styles.voiceNote} ${styles.voiceNoteMine}`
            : variant === "other"
              ? `${styles.voiceNote} ${styles.voiceNoteOther}`
              : `${styles.voiceNote} ${styles.voiceNoteComposer}`

    if (error) {
        return <span className={styles.voiceNoteError}>Не удалось загрузить аудио</span>
    }

    if (pending || !src) {
        return (
            <div className={`${wrapClass} ${styles.voiceNotePending}`} aria-busy="true">
                <div className={styles.voiceNotePendingInner}>
                    <div className={styles.voiceNotePendingTrack} />
                    <span className={styles.voiceNotePendingLabel}>Загрузка…</span>
                </div>
            </div>
        )
    }

    return (
        <div className={wrapClass}>
            <audio ref={audioRef} className={styles.voiceNoteAudioEl} preload="metadata" />
            <button
                type="button"
                className={styles.voiceNotePlay}
                onClick={(e) => {
                    e.stopPropagation()
                    toggle()
                }}
                aria-label={playing ? "Пауза" : "Воспроизвести"}
            >
                {playing ? (
                    <VoicePauseGlyph className={styles.voiceNotePlayGlyph} />
                ) : (
                    <VoicePlayGlyph className={`${styles.voiceNotePlayGlyph} ${styles.voiceNotePlayGlyphPlay}`} />
                )}
            </button>
            <div className={styles.voiceNoteTrackCol}>
                <div
                    className={styles.voiceNoteTrack}
                    onClick={(e) => {
                        e.stopPropagation()
                        onSeek(e)
                    }}
                    role="slider"
                    aria-valuenow={Math.round(current)}
                    aria-valuemin={0}
                    aria-valuemax={Math.max(1, Math.round(shownEndSec))}
                    aria-label="Позиция воспроизведения"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        const a = audioRef.current
                        if (!a) return
                        const step = 5
                        const len = seekableDuration()
                        if (e.key === "ArrowRight") {
                            e.preventDefault()
                            a.currentTime = Math.min(len, a.currentTime + step)
                        } else if (e.key === "ArrowLeft") {
                            e.preventDefault()
                            a.currentTime = Math.max(0, a.currentTime - step)
                        } else if (e.key === " " || e.key === "Enter") {
                            e.preventDefault()
                            toggle()
                        }
                    }}
                >
                    <div className={styles.voiceNoteTrackFill} style={{ width: `${pct}%` }} />
                </div>
                <div className={styles.voiceNoteTimes}>
                    <span>{formatClock(current)}</span>
                    <span className={styles.voiceNoteTimesSep}>/</span>
                    <span>{formatClock(shownEndSec)}</span>
                </div>
            </div>
        </div>
    )
}
