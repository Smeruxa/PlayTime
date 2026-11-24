import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"

type Props = {
    stream: MediaStream
    className: string
    isLocalPreview?: boolean
    muted?: boolean
    volume?: number
}

const LocalScreenVideo = forwardRef<HTMLVideoElement, Props>(function LocalScreenVideo(
    { stream, className, isLocalPreview = false, muted = false, volume = 100 },
    ref
) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const audioRef = useRef<HTMLAudioElement>(null)

    useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement, [])
    useEffect(() => {
        const video = videoRef.current,
            audio = audioRef.current
        return () => {
            for (const element of [video, audio])
                if (element) {
                    element.pause()
                    element.srcObject = null
                }
        }
    }, [])
    useEffect(() => {
        const video = videoRef.current
        const audio = audioRef.current
        if (!video) return
        video.muted = true
        const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume / 100)) : 0
        if (audio) {
            audio.volume = level
            audio.muted = muted || level === 0
        }

        const syncScreen = () => {
            const videoTracks = stream.getVideoTracks().filter((track) => track.readyState === "live")
            const currentVideo = video.srcObject as MediaStream | null
            if (
                !currentVideo ||
                currentVideo.getTracks().length !== videoTracks.length ||
                videoTracks.some((track) => !currentVideo.getTrackById(track.id))
            ) {
                video.srcObject = new MediaStream(videoTracks)
                void video.play().catch(() => {})
            }
            if (isLocalPreview || muted || level === 0) {
                if (audio) {
                    audio.pause()
                    audio.srcObject = null
                }
                return
            }
            const audioTracks = stream.getAudioTracks().filter((track) => track.readyState === "live")
            if (!audio || audioTracks.length === 0) {
                if (audio) {
                    audio.pause()
                    audio.srcObject = null
                }
                return
            }
            const currentAudio = audio.srcObject as MediaStream | null
            if (
                !currentAudio ||
                currentAudio.getTracks().length !== audioTracks.length ||
                audioTracks.some((track) => !currentAudio.getTrackById(track.id))
            ) {
                audio.srcObject = new MediaStream(audioTracks)
                void audio.play().catch(() => {})
            }
        }

        syncScreen()
        stream.addEventListener("addtrack", syncScreen)
        stream.addEventListener("removetrack", syncScreen)
        return () => {
            stream.removeEventListener("addtrack", syncScreen)
            stream.removeEventListener("removetrack", syncScreen)
        }
    }, [stream, isLocalPreview, muted, volume])

    useEffect(() => {
        const resume = () => {
            const el = videoRef.current
            if (!el) return
            const fs = document.fullscreenElement
            if (fs === el || fs?.contains(el)) void el.play().catch(() => {})
        }
        document.addEventListener("fullscreenchange", resume)
        return () => document.removeEventListener("fullscreenchange", resume)
    }, [])

    return (
        <>
            <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                controls={false}
                disablePictureInPicture
                className={className}
            />
            {!isLocalPreview ? <audio ref={audioRef} autoPlay playsInline style={{ display: "none" }} /> : null}
        </>
    )
})

export default LocalScreenVideo
