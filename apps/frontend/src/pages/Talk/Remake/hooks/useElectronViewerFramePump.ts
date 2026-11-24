import { useEffect, type MutableRefObject, type RefObject } from "react"
import { LOCAL_SCREEN_KEY } from "../constants"

type RemoteFrameTap = (username: string, frame: string) => void

function captureVideoFrame(video: HTMLVideoElement, quality = 0.72): string | null {
    if (video.readyState < 2) return null
    const w = video.videoWidth || 1280
    const h = video.videoHeight || 720
    if (!w || !h) return null
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)
    try {
        return canvas.toDataURL("image/jpeg", quality)
    } catch {
        return null
    }
}

export function useElectronViewerFramePump(
    electronViewerOpen: boolean,
    effectiveSelected: string | null,
    remoteScreensLatestRef: MutableRefObject<Record<string, MediaStream>>,
    remoteFrameTapRef: MutableRefObject<RemoteFrameTap | null>,
    mediaRef: RefObject<HTMLVideoElement | null>
) {
    useEffect(() => {
        if (!electronViewerOpen) {
            remoteFrameTapRef.current = null
            return undefined
        }

        const isLocal = effectiveSelected === LOCAL_SCREEN_KEY
        if (isLocal || !effectiveSelected) {
            remoteFrameTapRef.current = null
            return undefined
        }

        const api = window.electronAPI
        if (!api?.screenShareViewerSendFrame) return undefined

        const targetKey = effectiveSelected
        let lastSent = ""

        const sendFromStream = (stream: MediaStream | undefined) => {
            if (!stream) return
            const video = document.createElement("video")
            video.srcObject = stream
            video.muted = true
            video.playsInline = true
            void video
                .play()
                .then(() => {
                    const frame = captureVideoFrame(video)
                    video.srcObject = null
                    if (frame && frame !== lastSent) {
                        lastSent = frame
                        api.screenShareViewerSendFrame?.(frame)
                    }
                })
                .catch(() => {})
        }

        remoteFrameTapRef.current = (username, frame) => {
            if (username === targetKey && frame && frame !== lastSent) {
                lastSent = frame
                api.screenShareViewerSendFrame?.(frame)
            }
        }

        sendFromStream(remoteScreensLatestRef.current[targetKey])

        let stopped = false
        const intervalId = window.setInterval(() => {
            if (stopped) return
            const el = mediaRef.current
            if (el && el.srcObject instanceof MediaStream) {
                const frame = captureVideoFrame(el)
                if (frame && frame !== lastSent) {
                    lastSent = frame
                    api.screenShareViewerSendFrame?.(frame)
                }
                return
            }
            sendFromStream(remoteScreensLatestRef.current[targetKey])
        }, 1000 / 15)

        return () => {
            stopped = true
            remoteFrameTapRef.current = null
            window.clearInterval(intervalId)
        }
    }, [electronViewerOpen, effectiveSelected, remoteScreensLatestRef, remoteFrameTapRef, mediaRef])
}
