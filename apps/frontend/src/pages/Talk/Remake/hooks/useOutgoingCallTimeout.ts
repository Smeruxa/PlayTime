import { useCallback, useEffect, useRef, type RefObject } from "react"
import type { Socket } from "socket.io-client"
import { publicAssetUrl } from "../../../../utils/publicAssetUrl"

const RING_TIMEOUT_MS = 60_000
const NO_ANSWER_CLOSE_MS = 2200

type Args = {
    socket: Socket | null
    roomId: string
    ownershipRevision?: number
    peerName: string
    enabled: boolean
    callRef: RefObject<HTMLAudioElement | null>
    suppressEndedCloseRef: RefObject<boolean>
    setCallState: (s: string) => void
    onClose: () => void
}

export function useOutgoingCallTimeout({
    socket,
    roomId,
    ownershipRevision,
    peerName,
    enabled,
    callRef,
    suppressEndedCloseRef,
    setCallState,
    onClose
}: Args) {
    const handledRef = useRef(false)
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    useEffect(
        () => () => {
            clearTimeout(closeTimerRef.current)
            closeTimerRef.current = undefined
            handledRef.current = false
            suppressEndedCloseRef.current = false
        },
        [roomId, ownershipRevision, suppressEndedCloseRef]
    )

    const finishNoAnswer = useCallback(() => {
        if (handledRef.current || !socket) return
        handledRef.current = true
        suppressEndedCloseRef.current = true

        setCallState(`${peerName} не отвечает`)

        const ring = callRef.current
        if (ring) {
            ring.pause()
            ring.currentTime = 0
            ring.loop = false
        }

        socket.emit("call:end", { roomId, ownershipRevision })

        try {
            const hangup = new Audio(publicAssetUrl("assets/sounds/declined.mp3"))
            hangup.volume = 1
            void hangup.play().catch(() => {})
        } catch {
        }

        closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = undefined
            suppressEndedCloseRef.current = false
            handledRef.current = false
            onClose()
        }, NO_ANSWER_CLOSE_MS)
    }, [socket, roomId, peerName, callRef, suppressEndedCloseRef, setCallState, onClose, ownershipRevision])

    useEffect(() => {
        if (!enabled || !socket || !roomId) return undefined

        handledRef.current = false

        const onNoAnswer = (data: { roomId?: string; ownershipRevision?: number }) => {
            if (data?.roomId != null && String(data.roomId) !== String(roomId)) return
            if (ownershipRevision !== undefined && data?.ownershipRevision !== ownershipRevision) return
            finishNoAnswer()
        }

        socket.on("call:noAnswer", onNoAnswer)
        const timer = window.setTimeout(finishNoAnswer, RING_TIMEOUT_MS)

        return () => {
            clearTimeout(timer)
            socket.off("call:noAnswer", onNoAnswer)
        }
    }, [enabled, socket, roomId, ownershipRevision, finishNoAnswer, suppressEndedCloseRef])
}
