import styles from "./Talk.module.css"
import panelStyles from "../../../features/call/CallPanel.module.css"
import CallControls from "../../../components/CallControls/CallControls"
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import type { VoiceMesh } from "../../../webrtc"
import { useMount } from "../../../hooks/useMount"
import { useSessionSocket } from "../../../server/socketContext"
import { useCallAudio } from "./hooks/useCallAudio"
import { usePartyAudio } from "./hooks/usePartyAudio"
import { useScreenShare } from "./hooks/useScreenShare"
import { usePartyParticipants } from "./hooks/usePartyParticipants"
import { useTalkScreenSources } from "./hooks/useTalkScreenSources"
import { useTalkParticipantAvatars } from "./hooks/useTalkParticipantAvatars"
import ScreenShareModal from "./ScreenShareModal"
import TalkScreenSharePanel from "./components/TalkScreenSharePanel"
import PartyCallSection from "./components/PartyCallSection"
import DirectCallParticipants from "./components/DirectCallParticipants"
import { TalkDirectCallAudios } from "./components/TalkDirectCallAudios"
import { CallProps } from "../../../types"
import type { FriendsAvatarsMap } from "../../../types/friendAvatar"
import { publicAssetUrl } from "../../../utils/publicAssetUrl"
import { useElectronViewerFramePump } from "./hooks/useElectronViewerFramePump"
import { useOutgoingCallTimeout } from "./hooks/useOutgoingCallTimeout"
import { useCallPing } from "./hooks/useCallPing"
import { CallPingInline } from "../../../features/call/components/CallPingInline"
import { LOCAL_SCREEN_KEY } from "./constants"
import { useScreenViewerMixer } from "./hooks/useScreenViewerMixer"
import { canStartScreenShare } from "../../../webrtc/screenCapture"
import { toggleScreenViewerFullscreen } from "./screenViewerFullscreen"

interface TalkProps {
    call: CallProps
    setShow: () => void
    setActiveCall?: (update: CallProps | null | ((prev: CallProps | null) => CallProps | null)) => void
    avatarByUsername?: FriendsAvatarsMap
}

export default function Talk({ setShow, call, setActiveCall, avatarByUsername: avatarByUsernameProp }: TalkProps) {
    const { socket, myName, myUserId } = useSessionSocket()
    const { names, roomId, incoming, isParty } = call
    const [mic, setMic] = useState(() => JSON.parse(localStorage.getItem("micState") || "true"))
    const [, setCallState] = useState(
        isParty ? "Подключение..." : !incoming ? "Вызываем пользователя..." : "Подключились"
    )

    const [valueSound, setValueSound] = useState<number>(() => {
        const saved = localStorage.getItem("valueSound")
        return saved !== null ? Number(saved) : 100
    })
    const [showScreenModal, setShowScreenModal] = useState(false)
    const [selectedScreenKey, setSelectedScreenKey] = useState<string | null>(null)
    const [screenShareMuted, setScreenShareMuted] = useState(false)
    const [electronViewerOpen, setElectronViewerOpen] = useState(false)
    const screenShareContainerRef = useRef<HTMLDivElement>(null)
    const screenShareMediaRef = useRef<HTMLVideoElement | null>(null)
    const suppressEndedCloseRef = useRef(false)
    const meshRef = useRef<VoiceMesh | null>(null)
    useEffect(() => localStorage.setItem("valueSound", valueSound.toString()), [valueSound])

    const peerName = useMemo(() => {
        const peer = names.find((n) => n && n !== myName)
        return (peer ?? names[0] ?? "Собеседник") as string
    }, [names, myName])

    const { avatarMap, avatarsReady } = useTalkParticipantAvatars(socket, avatarByUsernameProp)

    const callAudio = useCallAudio(
        socket,
        isParty ? "" : String(roomId),
        incoming,
        () => {
            if (setActiveCall)
                setActiveCall((prev) => (prev && !prev.isParty && String(prev.roomId) === String(roomId) ? null : prev))
            else setShow()
        },
        setCallState,
        setActiveCall ?? (() => {}),
        !!call.confirmed,
        myUserId,
        meshRef,
        suppressEndedCloseRef,
        { ownershipRevision: call.ownershipRevision, peerOwnershipRevision: call.peerOwnershipRevision }
    )
    const partyAudio = usePartyAudio(socket, isParty ? Number(roomId) : 0, setCallState, myUserId, meshRef)
    const audioError = isParty ? partyAudio.audioError : callAudio.audioError

    const meshReady = isParty ? partyAudio.audioReady && partyAudio.partyEntered : callAudio.audioReady

    const screenShare = useScreenShare(meshRef, meshReady)
    const { participants, listReady: partyParticipantsListReady } = usePartyParticipants(socket, !!isParty)
    const screenSources = useTalkScreenSources(screenShare.isSharing, screenShare.remoteScreens)

    const effectiveSelected =
        selectedScreenKey && screenSources.includes(selectedScreenKey) ? selectedScreenKey : (screenSources[0] ?? null)
    const hasMultipleScreens = screenSources.length > 1
    const { screenVolume, screenRestoreVolume, setScreenVolume } = useScreenViewerMixer({
        screenKey: effectiveSelected,
        screenLabel: effectiveSelected === LOCAL_SCREEN_KEY ? "Ваша демонстрация" : effectiveSelected || "Демонстрация",
        screenAvailable:
            !!effectiveSelected &&
            effectiveSelected !== LOCAL_SCREEN_KEY &&
            !!screenShare.remoteScreens[effectiveSelected],
        screenMuted: screenShareMuted,
        setScreenMuted: setScreenShareMuted
    })

    useEffect(() => {
        if (selectedScreenKey && !screenSources.includes(selectedScreenKey)) {
            setSelectedScreenKey(null)
        }
    }, [selectedScreenKey, screenSources])

    useEffect(() => {
        const sub = window.electronAPI?.screenShareViewerSubscribeClosed
        if (!sub) return undefined
        return sub(() => setElectronViewerOpen(false))
    }, [])

    useEffect(() => {
        if (!electronViewerOpen || effectiveSelected !== LOCAL_SCREEN_KEY) {
            screenShare.localFrameTapRef.current = null
            return undefined
        }
        const api = window.electronAPI
        if (!api?.screenShareViewerSendFrame) return undefined
        screenShare.localFrameTapRef.current = (url) => {
            api.screenShareViewerSendFrame?.(url)
        }
        const bootstrap = screenShare.lastLocalFrameRef.current
        if (bootstrap) api.screenShareViewerSendFrame?.(bootstrap)
        return () => {
            screenShare.localFrameTapRef.current = null
        }
    }, [electronViewerOpen, effectiveSelected, screenShare.localFrameTapRef, screenShare.lastLocalFrameRef])

    useElectronViewerFramePump(
        electronViewerOpen,
        effectiveSelected,
        screenShare.remoteScreensLatestRef,
        screenShare.remoteFrameTapRef,
        screenShareMediaRef
    )

    const handleScreenShareFullscreen = useCallback(async () => {
        const api = window.electronAPI
        if (api?.screenShareViewerOpen) {
            if (electronViewerOpen) {
                api.screenShareViewerClose?.()
                setElectronViewerOpen(false)
                return
            }
            try {
                const result = await api.screenShareViewerOpen()
                if (!result || result.ok) setElectronViewerOpen(true)
            } catch {
            }
            return
        }
        await toggleScreenViewerFullscreen(screenShareContainerRef.current)
    }, [electronViewerOpen])

    useMount(() => {
        const ref = screenShareContainerRef
        return () => {
            window.electronAPI?.screenShareViewerClose?.()
            const el = ref.current
            if (el && document.fullscreenElement === el) {
                document.exitFullscreen?.().catch(() => {})
            }
        }
    })

    const audioRefs = isParty
        ? {
              callRef: { current: null as HTMLAudioElement | null },
              confirmedRef: { current: null as HTMLAudioElement | null },
              declinedRef: { current: null as HTMLAudioElement | null }
          }
        : callAudio.audioRefs
    const setMicStateRef = isParty ? partyAudio.setMicStateRef : callAudio.setMicStateRef

    const stageReady = isParty
        ? avatarsReady && partyAudio.audioReady && partyParticipantsListReady && partyAudio.partyEntered
        : avatarsReady && callAudio.audioReady

    const pingSample = useCallPing(meshRef, socket, stageReady && meshReady)

    useOutgoingCallTimeout({
        socket,
        ownershipRevision: call.ownershipRevision,
        roomId: String(roomId),
        peerName,
        enabled: !isParty && !incoming && !call.confirmed && !!socket && !!roomId,
        callRef: callAudio.audioRefs.callRef,
        suppressEndedCloseRef,
        setCallState,
        onClose: setShow
    })

    const toggleMic = () => {
        const s = !mic
        setMic(s)
        localStorage.setItem("micState", JSON.stringify(s))
        setMicStateRef.current?.(s)
    }

    const handleScreenShareClick = () => {
        if (!canStartScreenShare()) return
        if (screenShare.isSharing) {
            screenShare.stopScreenShare()
        } else {
            setShowScreenModal(true)
        }
    }
    const handleScreenShareSelect = (stream: MediaStream) => {
        setShowScreenModal(false)
        if (!canStartScreenShare()) {
            stream.getTracks().forEach((track) => track.stop())
            return
        }
        screenShare.startScreenShare(stream)
    }

    const end = () => {
        setCallState("Отключено...")
        window.electronAPI?.screenShareViewerClose?.()
        setElectronViewerOpen(false)
        if (screenShare.isSharing) screenShare.stopScreenShare()
        if (isParty) {
            setShow()
            return
        }
        const callAudioEl = audioRefs.callRef.current
        if (callAudioEl && !callAudioEl.paused) {
            callAudioEl.pause()
            callAudioEl.currentTime = 0
        }
        try {
            const hangup = new Audio(publicAssetUrl("assets/sounds/declined.mp3"))
            hangup.volume = 1
            void hangup.play().catch(() => {})
        } catch {}
        socket?.emit("call:end", { roomId, ownershipRevision: call.ownershipRevision })
        setShow()
    }

    return (
        <>
            {!isParty ? <TalkDirectCallAudios audioRefs={audioRefs} /> : null}
            <div className={`${panelStyles.shell} ${styles.body}`}>
                <TalkScreenSharePanel
                    screenSources={screenSources}
                    effectiveSelected={effectiveSelected}
                    hasMultipleScreens={hasMultipleScreens}
                    localStream={screenShare.localStream}
                    remoteScreens={screenShare.remoteScreens}
                    screenShareMuted={screenShareMuted}
                    screenVolume={screenVolume}
                    setScreenVolume={setScreenVolume}
                    setScreenShareMuted={(update) => {
                        const next = typeof update === "function" ? update(screenShareMuted) : update
                        if (!next && screenVolume === 0) setScreenVolume(screenRestoreVolume)
                        setScreenShareMuted(next)
                    }}
                    setSelectedScreenKey={setSelectedScreenKey}
                    containerRef={screenShareContainerRef}
                    mediaRef={screenShareMediaRef}
                    onRequestFullscreen={handleScreenShareFullscreen}
                    electronViewerOpen={electronViewerOpen}
                />
                {audioError ? (
                    <div className={styles.audioError} role="alert">
                        <span>{audioError}</span>
                        <button type="button" onClick={isParty ? partyAudio.retryAudio : callAudio.retryAudio}>
                            Повторить
                        </button>
                    </div>
                ) : isParty ? (
                    <PartyCallSection
                        roomTitle={names[0] ?? "Комната"}
                        myName={myName}
                        participants={participants}
                        valueSound={valueSound}
                        setValueSound={setValueSound}
                        avatarByUsername={avatarMap}
                        stageReady={stageReady}
                    />
                ) : (
                    <DirectCallParticipants
                        names={names}
                        myName={myName}
                        valueSound={valueSound}
                        setValueSound={setValueSound}
                        avatarByUsername={avatarMap}
                        stageReady={stageReady}
                    />
                )}
                <div className={panelStyles.controlsRow} role="group" aria-label="Управление звонком">
                    <CallControls
                        mic={mic}
                        toggleMic={toggleMic}
                        end={end}
                        onScreenShare={handleScreenShareClick}
                        isSharingScreen={screenShare.isSharing}
                    />
                    {stageReady && meshReady && pingSample.rttMs != null ? (
                        <CallPingInline rttMs={pingSample.rttMs} peerCount={pingSample.peerCount} />
                    ) : null}
                </div>
            </div>
            {showScreenModal && (
                <ScreenShareModal onSelect={handleScreenShareSelect} onClose={() => setShowScreenModal(false)} />
            )}
        </>
    )
}
