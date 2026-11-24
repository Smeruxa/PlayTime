import { useCallback, useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useSessionSocket, useCallState } from "../server/socketContext"
import { CallOnAnotherDevice } from "../features/call/components/CallOnAnotherDevice"
import { IncomingCallPrompt } from "../features/call/components/IncomingCallPrompt"
import type { IncomingCallAnswer } from "../features/call/incomingCallWindowTypes"
import { parseDirectCallRoom } from "../webrtc/parseDirectRoom"
import {
    callFromState,
    mergeDirectCall,
    resolveDirectCallResponse,
    validCallMedia,
    type DirectCallState
} from "./directCallState"

export type CallIncomingType = { from: string; fromUserId?: number; roomId: string; expiresAt?: number }

export default function IncomingCallHandler() {
    const [incomingCall, setIncomingCall] = useState<CallIncomingType | null>(null)
    const [elsewhere, setElsewhere] = useState<DirectCallState | null>(null)
    const [reply, setReply] = useState<{ roomId: string; busy: boolean; error: string | null } | null>(null)
    const { socket, myUserId, myName } = useSessionSocket()
    const { setActiveCall } = useCallState()
    const navigate = useNavigate()
    const navigateRef = useRef(navigate)
    navigateRef.current = navigate
    const incomingRef = useRef(incomingCall)
    const elsewhereRef = useRef<DirectCallState | null>(null)
    const applyStateRef = useRef<((state: DirectCallState) => void) | null>(null)
    const recoverRef = useRef<(() => void) | null>(null)
    const answerRef = useRef<((answer: IncomingCallAnswer) => boolean) | null>(null)
    const requestAnswer = useCallback((answer: IncomingCallAnswer) => answerRef.current?.(answer) === true, [])
    incomingRef.current = incomingCall

    useEffect(() => {
        setIncomingCall(null)
        incomingRef.current = null
        setElsewhere(null)
        setReply(null)
        elsewhereRef.current = null
        if (!socket || myUserId == null) return
        const ended = new Set<string>()
        const revisions = new Map<string, number>()
        const ownershipRevisions = new Map<string, number>()
        const activeOwnership = new Map<string, number>()
        let generation = 0
        let disposed = false
        let answering: IncomingCallAnswer | null = null
        const updateElsewhere = (next: DirectCallState | null) => {
            elsewhereRef.current = next
            setElsewhere(next)
        }
        const state = (data: DirectCallState) => {
            if (!data || typeof data.roomId !== "string" || !data.caller || !data.receiver) return
            if (!validCallMedia(data)) return
            if (data.caller.id !== myUserId && data.receiver.id !== myUserId) return
            if (ended.has(data.roomId) || (revisions.get(data.roomId) ?? 0) > data.revision) return
            const ownership = data.media?.ownershipRevision
            if (ownership !== undefined && (ownershipRevisions.get(data.roomId) ?? 0) > ownership) return
            generation++
            revisions.set(data.roomId, data.revision)
            if (ownership !== undefined) ownershipRevisions.set(data.roomId, ownership)
            if (revisions.size > 100) {
                const oldest = revisions.keys().next().value!
                revisions.delete(oldest)
                ownershipRevisions.delete(oldest)
                activeOwnership.delete(oldest)
            }
            const incomingRing = data.status === "request_receiver" && data.receiver.id === myUserId
            if (incomingRing) {
                activeOwnership.delete(data.roomId)
                if (!data.expiresAt || data.expiresAt > Date.now()) {
                    updateElsewhere(null)
                    const next = {
                        from: data.caller.username,
                        fromUserId: data.caller.id,
                        roomId: data.roomId,
                        expiresAt: data.expiresAt
                    }
                    incomingRef.current = next
                    setIncomingCall(next)
                }
                return
            }
            if (data.media && !data.media.active) {
                activeOwnership.delete(data.roomId)
                if (incomingRef.current?.roomId === data.roomId) incomingRef.current = null
                setIncomingCall((previous) => (previous?.roomId === data.roomId ? null : previous))
                setActiveCall((previous) =>
                    previous && !previous.isParty && previous.roomId === data.roomId ? null : previous
                )
                updateElsewhere(data)
                return
            }
            const next = callFromState(data, myUserId)
            if (!next) return
            if (ownership !== undefined) activeOwnership.set(data.roomId, ownership)
            updateElsewhere(null)
            if (incomingRef.current?.roomId === data.roomId) incomingRef.current = null
            setIncomingCall((previous) => (previous?.roomId === data.roomId ? null : previous))
            setActiveCall((previous) => mergeDirectCall(previous, next))
        }
        const incoming = (data: CallIncomingType) => {
            if (!data || typeof data.from !== "string" || typeof data.roomId !== "string" || ended.has(data.roomId))
                return
            if ((revisions.get(data.roomId) ?? 0) >= 2 || (data.expiresAt && data.expiresAt <= Date.now())) return
            generation++
            const previous = incomingRef.current?.roomId === data.roomId ? incomingRef.current : null
            const parsed = parseDirectCallRoom(data.roomId)
            const senderId = data.fromUserId
            const fromUserId =
                previous?.fromUserId ??
                (typeof senderId === "number" && Number.isSafeInteger(senderId) && senderId > 0 && senderId !== myUserId
                    ? senderId
                    : parsed?.receiverId === myUserId
                      ? parsed.callerId
                      : undefined)
            const next = {
                from: data.from,
                fromUserId,
                roomId: data.roomId,
                expiresAt: data.expiresAt ?? previous?.expiresAt
            }
            incomingRef.current = next
            setIncomingCall(next)
        }
        const finished = (data: { roomId?: string }) => {
            if (!data?.roomId) return
            generation++
            ended.add(data.roomId)
            activeOwnership.delete(data.roomId)
            if (incomingRef.current?.roomId === data.roomId) incomingRef.current = null
            if (ended.size > 100) ended.delete(ended.values().next().value!)
            setIncomingCall((previous) => (previous?.roomId === data.roomId ? null : previous))
            setActiveCall((previous) =>
                previous && !previous.isParty && previous.roomId === data.roomId ? null : previous
            )
            if (elsewhereRef.current?.roomId === data.roomId) updateElsewhere(null)
        }
        const confirmed = (data: { roomId?: string; ownershipRevision?: number }) => {
            if (!data?.roomId || ended.has(data.roomId) || elsewhereRef.current?.roomId === data.roomId) return
            const modern = ownershipRevisions.has(data.roomId) || data.ownershipRevision !== undefined
            if (
                modern &&
                (!Number.isSafeInteger(data.ownershipRevision) ||
                    data.ownershipRevision! <= 0 ||
                    activeOwnership.get(data.roomId) !== data.ownershipRevision)
            ) {
                recover()
                return
            }
            generation++
            revisions.set(data.roomId, Math.max(revisions.get(data.roomId) ?? 0, 2))
            const roomId = data.roomId
            const current = incomingRef.current
            if (current?.roomId === roomId) incomingRef.current = null
            setIncomingCall((previous) => (previous?.roomId === roomId ? null : previous))
            setActiveCall((previous) => {
                if (previous && previous.roomId === roomId && !previous.isParty) {
                    if (modern && previous.ownershipRevision !== data.ownershipRevision) return previous
                    return { ...previous, confirmed: true, revision: Math.max(previous.revision ?? 0, 2) }
                }
                if (!modern && current && current.roomId === roomId) {
                    return { names: [current.from, myName], roomId, incoming: true, confirmed: true, revision: 2 }
                }
                return previous
            })
        }
        const recover = () => {
            const expected = generation
            socket
                .timeout(8000)
                .emit("call:current", (error: Error | null, response?: { state?: DirectCallState | null }) => {
                    if (disposed || error || expected !== generation || !response || !("state" in response)) return
                    if (response.state) state(response.state)
                    else {
                        incomingRef.current = null
                        activeOwnership.clear()
                        setIncomingCall(null)
                        updateElsewhere(null)
                        setActiveCall((previous) => (previous?.isParty ? previous : null))
                    }
                })
        }
        const ownershipLost = (data: { roomId?: string; ownershipRevision?: number }) => {
            if (!data?.roomId || !Number.isSafeInteger(data.ownershipRevision) || data.ownershipRevision! <= 0) return
            if ((ownershipRevisions.get(data.roomId) ?? 0) > data.ownershipRevision!) return
            ownershipRevisions.set(data.roomId, data.ownershipRevision!)
            activeOwnership.delete(data.roomId)
            if (incomingRef.current?.roomId === data.roomId) incomingRef.current = null
            generation++
            setActiveCall((previous) =>
                previous && !previous.isParty && previous.roomId === data.roomId ? null : previous
            )
            setIncomingCall((previous) => (previous?.roomId === data.roomId ? null : previous))
            recover()
        }
        const visible = () => {
            if (document.visibilityState === "visible") recover()
        }
        const answer = (request: IncomingCallAnswer) => {
            const { roomId, accept } = request
            const call = incomingRef.current
            if (
                !call ||
                call.roomId !== roomId ||
                answering?.roomId === roomId ||
                (call.expiresAt !== undefined && call.expiresAt <= Date.now())
            )
                return false

            answering = request
            setReply({ roomId, busy: true, error: null })
            socket
                .timeout(8_000)
                .emit(
                    "call:confirm",
                    { roomId, accept },
                    (
                        failure: Error | null,
                        response?: { success?: boolean; state?: DirectCallState | null; err?: string }
                    ) => {
                        if (disposed || answering !== request) return
                        answering = null
                        const current = incomingRef.current
                        if (ended.has(roomId) || (current && current.roomId !== roomId)) return
                        if (failure || !response?.success) {
                            if (current) {
                                setReply({
                                    roomId,
                                    busy: false,
                                    error: response?.err || "Не удалось ответить. Проверьте соединение."
                                })
                            }
                            return
                        }

                        if (current?.roomId === roomId) incomingRef.current = null
                        setIncomingCall((previous) => (previous?.roomId === roomId ? null : previous))
                        if (!accept || elsewhereRef.current?.roomId === roomId) return
                        const next = resolveDirectCallResponse(response.state, myUserId, {
                            names: [call.from, myName],
                            roomId,
                            incoming: true,
                            confirmed: true
                        })
                        if (!next?.confirmed || next.roomId !== roomId) return
                        if ((ownershipRevisions.get(roomId) ?? 0) > (next.ownershipRevision ?? 0)) return
                        setActiveCall((previous) => mergeDirectCall(previous, next))
                        window.windowControls?.focus?.()
                        navigateRef.current("/content", { state: { name: call.from, peerUserId: call.fromUserId } })
                    }
                )
            return true
        }
        applyStateRef.current = state
        recoverRef.current = recover
        answerRef.current = answer
        socket.on("call:state", state)
        socket.on("call:incomingCall", incoming)
        socket.on("call:confirmed", confirmed)
        socket.on("call:ownershipLost", ownershipLost)
        socket.on("call:ended", finished)
        socket.on("call:rejected", finished)
        socket.on("connect", recover)
        document.addEventListener("visibilitychange", visible)
        if (socket.connected) recover()
        return () => {
            disposed = true
            applyStateRef.current = null
            recoverRef.current = null
            answerRef.current = null
            socket.off("call:state", state)
            socket.off("call:incomingCall", incoming)
            socket.off("call:confirmed", confirmed)
            socket.off("call:ownershipLost", ownershipLost)
            socket.off("call:ended", finished)
            socket.off("call:rejected", finished)
            socket.off("connect", recover)
            document.removeEventListener("visibilitychange", visible)
        }
    }, [socket, myUserId, myName, setActiveCall])

    useEffect(() => {
        if (!incomingCall?.expiresAt) return
        const { roomId, expiresAt } = incomingCall
        const timer = setTimeout(
            () => {
                if (incomingRef.current?.roomId !== roomId || incomingRef.current.expiresAt !== expiresAt) return
                incomingRef.current = null
                setIncomingCall(null)
            },
            Math.max(0, expiresAt - Date.now())
        )
        return () => clearTimeout(timer)
    }, [incomingCall])

    if (incomingCall) {
        const currentReply = reply?.roomId === incomingCall.roomId ? reply : null
        return (
            <IncomingCallPrompt
                key={incomingCall.roomId}
                call={incomingCall}
                busy={currentReply?.busy ?? false}
                error={currentReply?.error ?? null}
                onAnswer={requestAnswer}
            />
        )
    }
    return elsewhere && socket && myUserId != null ? (
        <CallOnAnotherDevice
            key={elsewhere.roomId}
            call={elsewhere}
            userId={myUserId}
            socket={socket}
            onClaimed={(data) => applyStateRef.current?.(data)}
            onRefresh={() => recoverRef.current?.()}
        />
    ) : null
}
