import { useEffect, useRef, useState, type RefObject } from "react"
import { VoiceMesh, waitForWebrtcConfig, type RemotePeerMeta } from "../../../../webrtc"
import { microphoneError } from "../../../../platform/mediaErrors"

export const usePartyAudio = (
    socket: any,
    roomId: number,
    setCallState: (s: string) => void,
    myUserId: number | null,
    meshRef: RefObject<VoiceMesh | null>
) => {
    const [audioReady, setAudioReady] = useState(false)
    const [partyEntered, setPartyEntered] = useState(false)
    const [audioError, setAudioError] = useState<string | null>(null)
    const retryAudioRef = useRef<() => void>(() => {})
    const setMicStateRef = useRef<((s: boolean) => void) | null>(null)
    const setCallStateRef = useRef(setCallState)
    setCallStateRef.current = setCallState

    useEffect(() => {
        if (!socket || !roomId || roomId <= 0 || myUserId == null) {
            setAudioReady(false)
            setPartyEntered(false)
            return
        }
        setAudioReady(false)
        setPartyEntered(false)
        setAudioError(null)
        let destroyed = false
        let lastParticipants: RemotePeerMeta[] = []
        let meshStarting: Promise<VoiceMesh | null> | null = null
        let enterGeneration = 0
        let enterTimer: ReturnType<typeof setTimeout> | undefined

        const stopAll = async () => {
            destroyed = true
            retryAudioRef.current = () => {}
            clearTimeout(enterTimer)
            socket.off("party:participants:list", handleParticipantsList)
            socket.off("party:participant:joined", handleParticipantJoined)
            socket.off("party:participant:left", handleParticipantLeft)
            socket.off("party:roomClosed", handleRoomClosed)
            socket.off("room:removed", handleRoomClosed)
            socket.off("connect", enterRoom)
            socket.off("disconnect", handleDisconnect)
            socket.emit("room:leave", { roomId })
            await meshRef.current?.destroy()
            meshRef.current = null
            setMicStateRef.current = null
        }

        const ensureMesh = async (): Promise<VoiceMesh | null> => {
            if (destroyed) return null
            if (meshRef.current) return meshRef.current
            if (!meshStarting) {
                setAudioError(null)
                meshStarting = (async () => {
                    const iceServers = await waitForWebrtcConfig(socket)
                    if (destroyed) return null
                    const mesh = new VoiceMesh({
                        socket,
                        roomId,
                        context: "party",
                        myUserId,
                        iceServers
                    })
                    meshRef.current = mesh
                    setMicStateRef.current = (enabled: boolean) => mesh.setMicEnabled(enabled)
                    try {
                        await mesh.start()
                    } catch (error) {
                        await mesh.destroy()
                        if (meshRef.current === mesh) meshRef.current = null
                        if (!destroyed) {
                            setMicStateRef.current = null
                            setAudioError(microphoneError(error))
                        }
                        return null
                    }
                    return destroyed ? null : mesh
                })().finally(() => {
                    meshStarting = null
                })
            }
            return meshStarting
        }

        const handleParticipantsList = (list: RemotePeerMeta[]) => {
            if (destroyed) return
            lastParticipants = list
            void (async () => {
                const mesh = await ensureMesh()
                if (!mesh || destroyed) return
                await mesh.connectPartyPeers(list)
                if (!destroyed) setAudioReady(true)
            })().catch((error) => {
                if (!destroyed) setAudioError(microphoneError(error))
            })
        }
        retryAudioRef.current = () => handleParticipantsList(lastParticipants)

        const handleParticipantJoined = (p: RemotePeerMeta) => {
            if (destroyed || p.userId === myUserId) return
            void (async () => {
                const mesh = await ensureMesh()
                if (!mesh || destroyed) return
                await mesh.onPartyPeerJoined(p)
            })().catch((error) => {
                if (!destroyed) setAudioError(microphoneError(error))
            })
        }

        const handleParticipantLeft = (p: RemotePeerMeta) => {
            meshRef.current?.onPartyPeerLeft(p.userId)
        }
        const handleRoomClosed = (p: { roomId?: number }) => {
            if (p.roomId !== roomId) return
            void stopAll()
            setAudioReady(false)
            setCallStateRef.current("Доступ к комнате завершён")
        }

        const handleDisconnect = () => {
            enterGeneration++
            clearTimeout(enterTimer)
            setCallStateRef.current("Восстанавливаем соединение...")
        }

        const enterRoom = () => {
            if (destroyed || !socket.connected) return
            clearTimeout(enterTimer)
            const generation = ++enterGeneration
            socket
                .timeout(8_000)
                .emit("room:enter", { roomId }, (error: Error | null, res?: { success?: boolean; err?: string }) => {
                    if (destroyed || generation !== enterGeneration || !socket.connected) return
                    if (error || res?.err === "Server error") {
                        enterTimer = setTimeout(enterRoom, 2_000)
                        return
                    }
                    if (!res?.success) {
                        setCallStateRef.current(res?.err ?? "Не удалось войти в комнату")
                        setPartyEntered(true)
                        return
                    }
                    meshRef.current?.reconnect()
                    setCallStateRef.current("В голосовом чате")
                    setPartyEntered(true)
                })
        }

        socket.on("party:participants:list", handleParticipantsList)
        socket.on("party:participant:joined", handleParticipantJoined)
        socket.on("party:participant:left", handleParticipantLeft)
        socket.on("party:roomClosed", handleRoomClosed)
        socket.on("room:removed", handleRoomClosed)
        socket.on("connect", enterRoom)
        socket.on("disconnect", handleDisconnect)
        enterRoom()

        return () => {
            stopAll()
        }
    }, [socket, roomId, myUserId, meshRef])

    return { setMicStateRef, audioReady, partyEntered, audioError, retryAudio: () => retryAudioRef.current() }
}
