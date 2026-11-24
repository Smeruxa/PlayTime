import { useMemo } from "react"
import type { FriendsAvatarsMap } from "../../../../types/friendAvatar"
import { CallVolumeControl } from "../../../../features/call/components/CallVolumeControl"
import {
    CallParticipantsStage,
    type StageParticipant
} from "../../../../features/call/components/CallParticipantsStage"
import {
    CallParticipantsSkeleton,
    CallVolumeSkeleton
} from "../../../../features/call/components/CallParticipantsSkeleton"
import shellStyles from "../../../../features/call/components/CallStageShell.module.css"

type Props = {
    names: (string | null | undefined)[]
    myName: string | null
    valueSound: number
    setValueSound: (n: number) => void
    avatarByUsername: FriendsAvatarsMap
    stageReady: boolean
}

function resolvePeerAndSelf(names: (string | null | undefined)[], myName: string | null) {
    const unique = Array.from(new Set(names.map((n) => (n ?? "").trim()).filter(Boolean)))
    const self = myName?.trim() || unique.find(() => unique.length === 1) || ""
    const peer = unique.find((n) => n !== self) ?? ""
    return { peer, self: self || unique[1] || "" }
}

function toStageParticipant(
    username: string,
    isSelf: boolean,
    avatarByUsername: FriendsAvatarsMap
): StageParticipant {
    const meta = avatarByUsername[username]
    return {
        id: username,
        username,
        avatarUrl: meta?.avatar ?? null,
        avatarEffect: meta?.profileAvatarEffect ?? "none",
        isSelf
    }
}

export default function DirectCallParticipants({
    names,
    myName,
    valueSound,
    setValueSound,
    avatarByUsername,
    stageReady
}: Props) {
    const { peer, self } = useMemo(() => resolvePeerAndSelf(names, myName), [names, myName])

    const participants = useMemo(() => {
        const list: StageParticipant[] = []
        if (peer) list.push(toStageParticipant(peer, false, avatarByUsername))
        if (self) list.push(toStageParticipant(self, true, avatarByUsername))
        return list
    }, [peer, self, avatarByUsername])

    const skeletonCount = Math.max(participants.length, 2)

    return (
        <div className={shellStyles.shell}>
            {stageReady ? (
                <CallParticipantsStage participants={participants} duoAlignEnds />
            ) : (
                <CallParticipantsSkeleton count={skeletonCount} duoAlignEnds />
            )}
            <div className={shellStyles.volumeRow}>
                {stageReady ? (
                    <CallVolumeControl wide value={valueSound} onChange={setValueSound} ariaLabel="Громкость звонка" />
                ) : (
                    <CallVolumeSkeleton />
                )}
            </div>
        </div>
    )
}
