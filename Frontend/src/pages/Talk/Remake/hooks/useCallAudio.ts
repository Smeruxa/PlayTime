import { useEffect, useRef } from "react"
import { initAudio, playAudio } from "../../../../conversation/conversation"

export const useCallAudio = (socket: any, roomId: string, incoming: boolean, onEnd: () => void, setCallState: (s: string) => void) => {
    const audioContextRef = useRef<AudioContext | null>(null)
    const mediaStreamRef = useRef<MediaStream | null>(null)
    const setMicStateRef = useRef<((s: boolean) => void) | null>(null)
    const callRef = useRef<HTMLAudioElement | null>(null)
    const confirmedRef = useRef<HTMLAudioElement | null>(null)
    const declinedRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        if (!socket || !roomId) return
        let destroyed = false
        let audioContext: AudioContext | null = null
        let mediaStream: MediaStream | null = null

        const stopAll = async () => {
            destroyed = true
            socket.off("call:confirmed", handleConfirmed)
            socket.off("call:rejected", handleEnded)
            socket.off("call:ended", handleEnded)
            socket.off("call:room:receive", handleVoice)
            mediaStream?.getTracks().forEach(t => t.stop())
            if (audioContext?.state !== "closed") await audioContext?.close().catch(() => {})
            audioContextRef.current = null
            mediaStreamRef.current = null
        }

        const handleConfirmed = () => {
            if (destroyed) return
            stopCall()
            if (!incoming)
                setCallState("Пользователь подключен")
            confirmedRef.current?.play()
        }

        const handleEnded = () => {
            if (destroyed) return
            stopCall()
            declinedRef.current?.play().finally(() => stopAll().then(onEnd))
        }

        const handleVoice = (p: { voiceData: ArrayBuffer }) => {
            if (destroyed || !audioContext) return
            playAudio(audioContext, p.voiceData)
        }

        const stopCall = () => {
            const a = callRef.current
            if (!a) return
            a.pause()
            a.currentTime = 0
            a.loop = false
        }

        const setup = async () => {
            const r = await initAudio(socket, roomId)
            if (destroyed) {
                r.mediaStream.getTracks().forEach(t => t.stop())
                await r.audioContext.close().catch(() => {})
                return
            }
            audioContext = r.audioContext
            mediaStream = r.mediaStream
            audioContextRef.current = audioContext
            mediaStreamRef.current = mediaStream
            setMicStateRef.current = r.setMicState
        }

        setup()
        if (!incoming && callRef.current) {
            callRef.current.loop = true
            callRef.current.play()
        }

        socket.on("call:confirmed", handleConfirmed)
        socket.on("call:rejected", handleEnded)
        socket.on("call:ended", handleEnded)
        socket.on("call:room:receive", handleVoice)

        return () => { stopAll() }
    }, [socket, roomId])

    return { audioRefs: { callRef, confirmedRef, declinedRef }, setMicStateRef }
}