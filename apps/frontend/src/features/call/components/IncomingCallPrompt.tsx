import { useCallback, useEffect, useRef } from "react"
import ModalWindow from "../../../components/ModalWindow/ModalWindow"
import type { CallIncomingType } from "../../../utils/IncomingCallHandler"
import { publicAssetUrl } from "../../../utils/publicAssetUrl"
import { usePublicProfile } from "../../chat/hooks/usePublicProfile"
import type { IncomingCallAnswer } from "../incomingCallWindowTypes"

type Props = {
    call: CallIncomingType
    busy: boolean
    error: string | null
    onAnswer: (answer: IncomingCallAnswer) => boolean
}

export function IncomingCallPrompt({ call, busy, error, onAnswer }: Props) {
    const { roomId, from, fromUserId, expiresAt } = call
    const { showIncomingCall, hideIncomingCall, onIncomingCallAnswer } = window.electronAPI ?? {}
    const desktop = !!(showIncomingCall && hideIncomingCall && onIncomingCallAnswer)
    const { profile } = usePublicProfile(desktop ? from : null, fromUserId)
    const ringtone = useRef<HTMLAudioElement>(null)
    const accepted = useRef<HTMLAudioElement>(null)
    const rejected = useRef<HTMLAudioElement>(null)

    useEffect(() => {
        const audio = ringtone.current
        if (!audio) return
        void audio.play().catch(() => {})
        return () => audio.pause()
    }, [])

    const answer = useCallback(
        (accept: boolean) => {
            if (!onAnswer({ roomId, accept })) return
            const audio = accept ? accepted.current : rejected.current
            void audio?.play().catch(() => {})
        },
        [onAnswer, roomId]
    )

    useEffect(() => {
        if (!desktop || !onIncomingCallAnswer || !hideIncomingCall) return
        const unsubscribe = onIncomingCallAnswer((request) => {
            if (request.roomId === roomId) answer(request.accept)
        })
        return () => {
            unsubscribe()
            hideIncomingCall(roomId)
        }
    }, [desktop, onIncomingCallAnswer, hideIncomingCall, roomId, answer])

    useEffect(() => {
        if (!desktop) return
        showIncomingCall?.({
            roomId,
            from,
            expiresAt,
            avatar: profile?.avatar,
            profileBanner: profile?.profileBanner,
            profileAvatarEffect: profile?.profileAvatarEffect,
            profileBannerEffect: profile?.profileBannerEffect,
            profileBannerSticker: profile?.profileBannerSticker,
            busy,
            error
        })
    }, [desktop, showIncomingCall, roomId, from, expiresAt, profile, busy, error])

    return (
        <>
            <audio ref={ringtone} src={publicAssetUrl("assets/sounds/call.mp3")} preload="auto" loop />
            <audio ref={accepted} src={publicAssetUrl("assets/sounds/confirmed.mp3")} preload="auto" />
            <audio ref={rejected} src={publicAssetUrl("assets/sounds/declined.mp3")} preload="auto" />
            {!desktop && <ModalWindow call={call} busy={busy} error={error} onAnswer={answer} />}
        </>
    )
}
