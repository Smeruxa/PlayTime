import { useState, useRef, useCallback, useEffect, type RefObject, type MutableRefObject } from "react"
import { useMount } from "../../../../hooks/useMount"
import type { VoiceMesh } from "../../../../webrtc"
import { canStartScreenShare } from "../../../../webrtc/screenCapture"

export function useScreenShare(meshRef: RefObject<VoiceMesh | null>, meshReady: boolean) {
    const [isSharing, setIsSharing] = useState(false)
    const [localStream, setLocalStream] = useState<MediaStream | null>(null)
    const [remoteScreens, setRemoteScreens] = useState<Record<string, MediaStream>>({})
    const remoteScreensLatestRef = useRef<Record<string, MediaStream>>({})
    const streamRef = useRef<MediaStream | null>(null)
    const localFrameTapRef = useRef<((frame: string) => void) | null>(null)
    const remoteFrameTapRef = useRef<((username: string, frame: string) => void) | null>(null)
    const lastLocalFrameRef = useRef<string | null>(null)
    const localCaptureStopRef = useRef<(() => void) | null>(null)

    useEffect(() => {
        remoteScreensLatestRef.current = remoteScreens
    }, [remoteScreens])

    useEffect(() => {
        if (!meshReady) return undefined
        const mesh = meshRef.current
        if (!mesh) return undefined
        return mesh.onScreenShare(({ username, stream }) => {
            setRemoteScreens((prev) => {
                const next = { ...prev }
                if (!stream) {
                    delete next[username]
                } else {
                    next[username] = stream
                }
                remoteScreensLatestRef.current = next
                return next
            })
        })
    }, [meshRef, meshReady])

    const stopLocalCaptureTap = useCallback(() => {
        localCaptureStopRef.current?.()
        localCaptureStopRef.current = null
    }, [])

    const startLocalCaptureTap = useCallback(
        (stream: MediaStream) => {
            stopLocalCaptureTap()
            const video = document.createElement("video")
            video.srcObject = stream
            video.muted = true
            video.playsInline = true
            Object.assign(video.style, { position: "fixed", left: "-9999px", opacity: "0" })
            document.body.appendChild(video)
            void video.play().catch(() => {})

            const canvas = document.createElement("canvas")
            const ctx = canvas.getContext("2d")
            let running = true
            let lastEmit = 0

            const tick = () => {
                if (!running || !ctx || video.readyState < 2 || !localFrameTapRef.current) return
                const now = performance.now()
                if (now - lastEmit < 1000 / 15) return
                lastEmit = now
                const w = video.videoWidth || 1280
                const h = video.videoHeight || 720
                if (!w || !h) return
                canvas.width = w
                canvas.height = h
                ctx.drawImage(video, 0, 0, w, h)
                try {
                    const frame = canvas.toDataURL("image/jpeg", 0.72)
                    lastLocalFrameRef.current = frame
                    localFrameTapRef.current?.(frame)
                } catch {
                }
            }

            let vfcId: number | null = null
            const onVfc: VideoFrameRequestCallback = () => {
                if (!running) return
                tick()
                if (running && typeof video.requestVideoFrameCallback === "function") {
                    vfcId = video.requestVideoFrameCallback(onVfc)
                }
            }
            if (typeof video.requestVideoFrameCallback === "function") {
                vfcId = video.requestVideoFrameCallback(onVfc)
            } else {
                const id = window.setInterval(tick, 1000 / 15)
                localCaptureStopRef.current = () => {
                    running = false
                    window.clearInterval(id)
                    video.srcObject = null
                    if (video.parentNode) video.parentNode.removeChild(video)
                }
                return
            }

            localCaptureStopRef.current = () => {
                running = false
                if (vfcId != null && typeof video.cancelVideoFrameCallback === "function") {
                    try {
                        video.cancelVideoFrameCallback(vfcId)
                    } catch {
                    }
                }
                video.srcObject = null
                if (video.parentNode) video.parentNode.removeChild(video)
            }
        },
        [stopLocalCaptureTap]
    )

    const stopScreenShare = useCallback(async () => {
        stopLocalCaptureTap()
        const stream = streamRef.current
        if (stream) {
            stream.getTracks().forEach((t) => t.stop())
            streamRef.current = null
        }
        setLocalStream(null)
        lastLocalFrameRef.current = null
        setIsSharing(false)
        await meshRef.current?.setScreenShare(null)
    }, [meshRef, stopLocalCaptureTap])

    useMount(() => {
        return () => {
            stopLocalCaptureTap()
            const stream = streamRef.current
            if (stream) {
                stream.getTracks().forEach((t) => t.stop())
                streamRef.current = null
            }
            void meshRef.current?.setScreenShare(null)
        }
    })

    const startScreenShare = useCallback(
        (stream: MediaStream) => {
            if (!canStartScreenShare()) {
                stream.getTracks().forEach((track) => track.stop())
                return
            }
            const mesh = meshRef.current
            if (!mesh) return
            streamRef.current = stream
            stream.getTracks().forEach((t) => {
                t.onended = () => {
                    void stopScreenShare()
                }
            })
            setLocalStream(stream)
            setIsSharing(true)
            startLocalCaptureTap(stream)
            void mesh.setScreenShare(stream)
        },
        [meshRef, stopScreenShare, startLocalCaptureTap]
    )

    return {
        startScreenShare,
        stopScreenShare,
        isSharing,
        localStream,
        remoteScreens,
        remoteScreensLatestRef: remoteScreensLatestRef as MutableRefObject<Record<string, MediaStream>>,
        localFrameTapRef,
        remoteFrameTapRef,
        lastLocalFrameRef
    }
}
