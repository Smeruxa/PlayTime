import { useCallback, useEffect, useRef, useState } from "react"
import { microphoneError } from "../../../platform/mediaErrors"

const PREFERRED_MIME = "audio/webm;codecs=opus"
const AUDIO_BITS = 72_000

export type VoiceRecorderPhase = "idle" | "recording" | "preview"

export function useVoiceRecorder(maxVoiceMessageSec = 120) {
    const maxSecRef = useRef(maxVoiceMessageSec)
    maxSecRef.current = maxVoiceMessageSec

    const [phase, setPhase] = useState<VoiceRecorderPhase>("idle")
    const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null)
    const [elapsedSec, setElapsedSec] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [preview, setPreview] = useState<{ blob: Blob; url: string; durationSec: number } | null>(null)

    const mediaRecRef = useRef<MediaRecorder | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const chunksRef = useRef<BlobPart[]>([])
    const startMsRef = useRef(0)
    const startingRef = useRef(false)
    const requestRef = useRef(0)
    const limitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const stopStream = () => {
        if (limitTimerRef.current !== null) clearTimeout(limitTimerRef.current)
        limitTimerRef.current = null
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
    }

    const discardPreviewBlob = useCallback(() => {
        setPreview(null)
    }, [])

    useEffect(() => () => {
        requestRef.current++
        const rec = mediaRecRef.current
        if (rec) {
            rec.onstop = null
            rec.ondataavailable = null
            rec.onerror = null
            try { if (rec.state !== "inactive") rec.stop() } catch {}
        }
        stopStream()
    }, [])

    useEffect(() => () => {
        if (preview) URL.revokeObjectURL(preview.url)
    }, [preview])

    useEffect(() => {
        if (phase !== "recording" || recordingStartedAt == null) return
        const id = window.setInterval(() => {
            const cap = maxSecRef.current
            setElapsedSec(Math.min(cap, (Date.now() - recordingStartedAt) / 1000))
        }, 200)
        return () => clearInterval(id)
    }, [phase, recordingStartedAt])

    useEffect(() => {
        if (phase !== "recording") return
        let raf = 0
        const tick = () => {
            const elapsed = (Date.now() - startMsRef.current) / 1000
            const cur = mediaRecRef.current
            if (elapsed >= maxSecRef.current && cur && cur.state === "recording") {
                try {
                    cur.stop()
                } catch {
                }
                return
            }
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [phase, maxVoiceMessageSec])

    const cancelRecording = useCallback(() => {
        requestRef.current++
        startingRef.current = false
        setError(null)
        const rec = mediaRecRef.current
        if (rec) {
            try {
                rec.onstop = null
                rec.ondataavailable = null
                rec.onerror = null
                if (rec.state !== "inactive") rec.stop()
            } catch {
            }
        }
        mediaRecRef.current = null
        stopStream()
        chunksRef.current = []
        setRecordingStartedAt(null)
        setElapsedSec(0)
        setPhase("idle")
    }, [])

    const afterVoiceSent = useCallback(() => {
        discardPreviewBlob()
        setRecordingStartedAt(null)
        setElapsedSec(0)
        setPhase("idle")
    }, [discardPreviewBlob])

    const cancelPreview = useCallback(() => {
        discardPreviewBlob()
        setPhase("idle")
    }, [discardPreviewBlob])

    const startRecording = useCallback(async () => {
        if (phase !== "idle" || startingRef.current) return
        startingRef.current = true
        const request = ++requestRef.current
        setError(null)
        discardPreviewBlob()
        try {
            if (typeof MediaRecorder === "undefined") {
                setError("Запись голосовых сообщений недоступна в этом браузере.")
                return
            }
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            if (request !== requestRef.current) {
                stream.getTracks().forEach((track) => track.stop())
                return
            }
            streamRef.current = stream
            chunksRef.current = []

            const chosen = [PREFERRED_MIME, "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
                .find((mime) => MediaRecorder.isTypeSupported(mime))

            const rec = new MediaRecorder(
                stream,
                chosen ? { mimeType: chosen, audioBitsPerSecond: AUDIO_BITS } : { audioBitsPerSecond: AUDIO_BITS }
            )
            mediaRecRef.current = rec

            rec.ondataavailable = (e) => {
                if (request === requestRef.current && e.data.size > 0) chunksRef.current.push(e.data)
            }

            rec.onerror = () => {
                if (request !== requestRef.current) return
                cancelRecording()
                setError("Запись прервалась. Проверьте микрофон и попробуйте снова.")
            }

            rec.onstop = () => {
                if (request !== requestRef.current) return
                stopStream()
                mediaRecRef.current = null
                const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" })
                chunksRef.current = []
                const durationSec = Math.min(maxSecRef.current, Math.max(0.2, (Date.now() - startMsRef.current) / 1000))
                setRecordingStartedAt(null)
                setElapsedSec(0)
                if (blob.size < 64) {
                    setPhase("idle")
                    return
                }
                const url = URL.createObjectURL(blob)
                setPreview({ blob, url, durationSec })
                setPhase("preview")
            }

            startMsRef.current = Date.now()
            setRecordingStartedAt(startMsRef.current)
            setElapsedSec(0)
            setPhase("recording")
            rec.start(400)
            limitTimerRef.current = setTimeout(() => {
                if (rec.state === "recording") rec.stop()
            }, maxSecRef.current * 1000)
        } catch (cause) {
            if (request !== requestRef.current) return
            stopStream()
            mediaRecRef.current = null
            chunksRef.current = []
            setRecordingStartedAt(null)
            setElapsedSec(0)
            setPhase("idle")
            setError(microphoneError(cause))
        } finally {
            if (request === requestRef.current) startingRef.current = false
        }
    }, [phase, discardPreviewBlob, cancelRecording])

    const stopRecording = useCallback(() => {
        const rec = mediaRecRef.current
        if (!rec || rec.state === "inactive") return
        try {
            rec.stop()
        } catch {
            cancelRecording()
        }
    }, [cancelRecording])

    return {
        error,
        phase,
        recordingSec: phase === "recording" ? elapsedSec : 0,
        previewUrl: preview?.url ?? null,
        previewBlob: preview?.blob ?? null,
        previewDurationSec: preview?.durationSec ?? 0,
        startRecording,
        stopRecording,
        cancelRecording,
        cancelPreview,
        afterVoiceSent
    }
}
