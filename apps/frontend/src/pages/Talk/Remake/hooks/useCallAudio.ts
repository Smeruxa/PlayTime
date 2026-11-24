import { useEffect, useRef, useState, type RefObject } from "react"
import { VoiceMesh, waitForWebrtcConfig, parseDirectCallRoom } from "../../../../webrtc"
import { microphoneError } from "../../../../platform/mediaErrors"

export const useCallAudio = (
    socket: any,
    roomId: string,
    incoming: boolean,
    onEnd: () => void,
    setCallState: (s: string) => void,
    setActiveCall: (update: ((prev: any) => any) | any) => void,
    confirmed: boolean,
    myUserId: number | null,
    meshRef: RefObject<VoiceMesh | null>,
    suppressEndedCloseRef?: RefObject<boolean>,
    ownership?: { ownershipRevision?: number; peerOwnershipRevision?: number }
) => {
    const [audioReady, setAudioReady] = useState(false)
    const [audioError, setAudioError] = useState<string | null>(null)
    const retryAudioRef = useRef<() => void>(() => {})
    const setMicStateRef = useRef<((s: boolean) => void) | null>(null)
    const callRef = useRef<HTMLAudioElement | null>(null)
    const confirmedRef = useRef<HTMLAudioElement | null>(null)
    const declinedRef = useRef<HTMLAudioElement | null>(null)
    const confirmedMediaRef = useRef(confirmed)
    const myUserIdRef = useRef(myUserId)
    const ownershipRef = useRef(ownership)
    ownershipRef.current = ownership
    const ownershipRevision = ownership?.ownershipRevision
    const identityRef = useRef({ roomId, ownershipRevision })
    identityRef.current = { roomId, ownershipRevision }

    useEffect(() => {
        if (ownershipRevision === undefined && ownership?.peerOwnershipRevision === undefined) return
        meshRef.current?.updateDirectOwnership(ownershipRevision, ownership?.peerOwnershipRevision)
    }, [meshRef, ownershipRevision, ownership?.peerOwnershipRevision])

    const incomingRef = useRef(incoming)
    const onEndRef = useRef(onEnd)
    const setCallStateRef = useRef(setCallState)
    const setActiveCallRef = useRef(setActiveCall)
    incomingRef.current = incoming
    onEndRef.current = onEnd
    setCallStateRef.current = setCallState
    setActiveCallRef.current = setActiveCall
    confirmedMediaRef.current = confirmed
    myUserIdRef.current = myUserId

    useEffect(() => {
        if (!socket || !roomId) {
            setAudioReady(false)
            return
        }
        setAudioReady(false)
        setAudioError(null)
        let destroyed = false
        let ending = false
        let meshStarting = false
        let resumeGeneration = 0
        let resumeTimer: ReturnType<typeof setTimeout> | undefined
        const isCurrent = () =>
            !destroyed &&
            identityRef.current.roomId === roomId &&
            identityRef.current.ownershipRevision === ownershipRevision

        const stopCall = () => {
            const a = callRef.current
            if (!a) return
            a.pause()
            a.currentTime = 0
            a.loop = false
        }

        const stopAll = async () => {
            const wasCurrent = isCurrent()
            destroyed = true
            if (wasCurrent) setAudioReady(false)
            clearTimeout(resumeTimer)
            meshStarting = false
            retryAudioRef.current = () => {}
            socket.off("call:confirmed", handleConfirmed)
            socket.off("call:ownershipLost", handleOwnershipLost)
            socket.off("call:rejected", handleEnded)
            socket.off("call:ended", handleEnded)
            socket.off("connect", resumeCall)
            socket.off("disconnect", handleDisconnect)
            const closingMesh = meshRef.current
            meshRef.current = null
            setMicStateRef.current = null
            await closingMesh?.destroy()
        }

        const startWebRtc = async () => {
            const uid = myUserIdRef.current
            if (!isCurrent() || meshRef.current || meshStarting || uid == null) return
            if (!confirmedMediaRef.current) return

            meshStarting = true
            setAudioError(null)
            let startingMesh: VoiceMesh | null = null
            try {
                const parsed = parseDirectCallRoom(roomId)
                if (!parsed || destroyed) return

                const iceServers = await waitForWebrtcConfig(socket)
                if (!isCurrent() || meshRef.current) return

                const mesh = new VoiceMesh({
                    socket,
                    roomId,
                    context: "direct",
                    myUserId: uid,
                    iceServers,
                    directCallerId: parsed.callerId,
                    ownershipRevision,
                    peerOwnershipRevision: ownershipRef.current?.peerOwnershipRevision
                })
                startingMesh = mesh
                meshRef.current = mesh
                setMicStateRef.current = (enabled: boolean) => mesh.setMicEnabled(enabled)
                await mesh.start()
                if (!isCurrent()) {
                    await mesh.destroy()
                    if (meshRef.current === mesh) meshRef.current = null
                    return
                }
                await mesh.startDirectCall()
                if (isCurrent()) setAudioReady(true)
            } catch (err) {
                await startingMesh?.destroy()
                if (meshRef.current === startingMesh) meshRef.current = null
                if (isCurrent()) {
                    setMicStateRef.current = null
                    setAudioError(microphoneError(err))
                }
            } finally {
                meshStarting = false
            }
        }
        retryAudioRef.current = () => void startWebRtc()

        const handleConfirmed = (data?: { roomId?: string; ownershipRevision?: number }) => {
            if (!isCurrent() || (data?.roomId != null && data.roomId !== roomId)) return
            if (ownershipRevision !== undefined && data?.ownershipRevision !== ownershipRevision) return
            stopCall()
            const wasConfirmed = confirmedMediaRef.current
            confirmedMediaRef.current = true
            setActiveCallRef.current((prev: any) =>
                prev?.roomId === roomId && prev.ownershipRevision === ownershipRevision
                    ? { ...prev, confirmed: true }
                    : prev
            )
            if (!incomingRef.current) setCallStateRef.current("Пользователь подключен")
            if (!wasConfirmed) void confirmedRef.current?.play().catch(() => {})
            void startWebRtc()
        }

        const handleEnded = (data?: { roomId?: string }) => {
            if (destroyed || ending) return
            if (data?.roomId != null && data.roomId !== roomId) return
            ending = true
            stopCall()
            if (suppressEndedCloseRef?.current) {
                void stopAll()
                return
            }
            const finish = onEndRef.current
            void (async () => {
                try {
                    await declinedRef.current?.play()
                } catch {
                }
                if (destroyed) return
                await stopAll()
                finish()
            })()
        }

        const handleOwnershipLost = (data: { roomId?: string; ownershipRevision?: number }) => {
            if (data?.roomId !== roomId || ownershipRevision === undefined) return
            if (!Number.isSafeInteger(data.ownershipRevision) || data.ownershipRevision! <= ownershipRevision) return
            void stopAll()
        }

        const handleDisconnect = () => {
            resumeGeneration++
            clearTimeout(resumeTimer)
            setCallStateRef.current("Восстанавливаем соединение...")
        }

        const resumeCall = () => {
            if (destroyed || ending || !socket.connected) return
            clearTimeout(resumeTimer)
            const generation = ++resumeGeneration
            socket
                .timeout(8_000)
                .emit(
                    "call:resume",
                    { roomId, ownershipRevision },
                    (
                        error: Error | null,
                        res?: { success?: boolean; status?: string; ended?: boolean; err?: string }
                    ) => {
                        if (destroyed || ending || generation !== resumeGeneration || !socket.connected) return
                        if (res?.ended || res?.err === "You are not part of this call") {
                            handleEnded({ roomId })
                            return
                        }
                        if (error || !res?.success) {
                            resumeTimer = setTimeout(resumeCall, 2_000)
                            return
                        }
                        if (res.status === "in_call") {
                            handleConfirmed({ roomId, ownershipRevision })
                            meshRef.current?.reconnect()
                            setCallStateRef.current("В звонке")
                        } else {
                            setCallStateRef.current("Вызываем пользователя...")
                        }
                    }
                )
        }

        const heartbeat = setInterval(() => {
            if (socket.connected) socket.emit("call:heartbeat", { roomId, ownershipRevision })
        }, 20_000)

        socket.on("call:confirmed", handleConfirmed)
        socket.on("call:ownershipLost", handleOwnershipLost)
        socket.on("call:rejected", handleEnded)
        socket.on("call:ended", handleEnded)
        socket.on("connect", resumeCall)
        socket.on("disconnect", handleDisconnect)

        if (!incomingRef.current && !confirmedMediaRef.current && callRef.current) {
            callRef.current.loop = true
            void callRef.current.play().catch(() => {})
        }

        if (confirmedMediaRef.current) {
            void startWebRtc()
        }

        return () => {
            clearInterval(heartbeat)
            stopAll()
        }
    }, [socket, roomId, myUserId, meshRef, suppressEndedCloseRef, ownershipRevision])

    return {
        audioRefs: { callRef, confirmedRef, declinedRef },
        setMicStateRef,
        audioReady,
        audioError,
        retryAudio: () => retryAudioRef.current()
    }
}
