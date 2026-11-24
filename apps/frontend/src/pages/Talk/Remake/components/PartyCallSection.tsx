import { useCallback, useMemo, useState } from "react"
import { setParticipantVolume, getParticipantVolumePercent } from "../../../../conversation"
import type { PartyParticipant } from "../types"
import type { FriendsAvatarsMap } from "../../../../types/friendAvatar"
import { CallVolumeControl } from "../../../../features/call/components/CallVolumeControl"
import { CallParticipantsStage } from "../../../../features/call/components/CallParticipantsStage"
import {
    CallParticipantsSkeleton,
    CallVolumeSkeleton,
    PartyCaptionSkeleton
} from "../../../../features/call/components/CallParticipantsSkeleton"
import { ParticipantVolumeModal } from "../../../../features/call/components/ParticipantVolumeModal"
import panelStyles from "../../../../features/call/CallPanel.module.css"

type Props = {
    roomTitle: string
    myName: string | null
    participants: PartyParticipant[]
    valueSound: number
    setValueSound: (n: number) => void
    avatarByUsername: FriendsAvatarsMap
    stageReady: boolean
}

export default function PartyCallSection({
    roomTitle,
    myName,
    participants,
    valueSound,
    setValueSound,
    avatarByUsername,
    stageReady
}: Props) {
    const [volumeModalUsername, setVolumeModalUsername] = useState<string | null>(null)
    const [volumeModalValue, setVolumeModalValue] = useState(100)

    const stageParticipants = useMemo(() => {
        const sorted = [...participants].sort((a, b) => {
            const aSelf = myName != null && a.username === myName
            const bSelf = myName != null && b.username === myName
            if (aSelf !== bSelf) return aSelf ? 1 : -1
            return a.username.localeCompare(b.username, "ru")
        })
        return sorted.map((p) => {
            const meta = avatarByUsername[p.username]
            return {
                id: p.userId,
                username: p.username,
                avatarUrl: meta?.avatar ?? null,
                avatarEffect: meta?.profileAvatarEffect ?? "none",
                isSelf: myName != null && p.username === myName
            }
        })
    }, [participants, myName, avatarByUsername])

    const openVolumeFor = useCallback((username: string) => {
        setVolumeModalUsername(username)
        setVolumeModalValue(getParticipantVolumePercent(username))
    }, [])

    const handleParticipantContextMenu = useCallback(
        (e: React.MouseEvent, username: string) => {
            if (myName != null && username === myName) return
            e.preventDefault()
            e.stopPropagation()
            openVolumeFor(username)
        },
        [myName, openVolumeFor]
    )

    const skeletonCount = Math.max(stageParticipants.length, 1)

    return (
        <div className={panelStyles.partyInner}>
            {stageReady ? (
                <p className={panelStyles.partyCaption} title={`Голосовой чат: ${roomTitle}`}>
                    <span className={panelStyles.partyCaptionLabel}>Голосовой чат</span>
                    <span className={panelStyles.partyCaptionSep} aria-hidden>
                        ·
                    </span>
                    <span className={panelStyles.partyCaptionRoom}>{roomTitle}</span>
                </p>
            ) : (
                <PartyCaptionSkeleton />
            )}
            {stageReady ? (
                <CallParticipantsStage
                    participants={stageParticipants}
                    emptyMessage="Участники появятся при подключении к голосу…"
                    onParticipantContextMenu={handleParticipantContextMenu}
                    duoAlignEnds={stageParticipants.length === 2}
                />
            ) : (
                <CallParticipantsSkeleton count={skeletonCount} duoAlignEnds={skeletonCount === 2} />
            )}
            <div className={panelStyles.partyVolume}>
                {stageReady ? (
                    <CallVolumeControl
                        wide
                        value={valueSound}
                        onChange={setValueSound}
                        ariaLabel="Общая громкость голосового чата"
                    />
                ) : (
                    <CallVolumeSkeleton />
                )}
            </div>
            {volumeModalUsername ? (
                <ParticipantVolumeModal
                    username={volumeModalUsername}
                    value={volumeModalValue}
                    onChange={(v) => {
                        setVolumeModalValue(v)
                        setParticipantVolume(volumeModalUsername, v)
                    }}
                    onClose={() => setVolumeModalUsername(null)}
                />
            ) : null}
        </div>
    )
}
