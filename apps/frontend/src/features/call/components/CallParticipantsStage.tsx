import CallUser from "../../../components/CallUser/CallUser"
import styles from "./CallParticipantsStage.module.css"

export type StageParticipant = {
    id: string | number
    username: string
    avatarUrl?: string | null
    avatarEffect?: string
    isSelf?: boolean
}

type Props = {
    participants: StageParticipant[]
    emptyMessage?: string
    onParticipantContextMenu?: (e: React.MouseEvent, username: string) => void
    duoAlignEnds?: boolean
}

export function CallParticipantsStage({
    participants,
    emptyMessage = "Участники появятся при подключении…",
    onParticipantContextMenu,
    duoAlignEnds = false
}: Props) {
    const count = participants.length

    if (count === 0) {
        return <p className={styles.empty}>{emptyMessage}</p>
    }

    const layoutClass =
        count >= 10
            ? styles.layoutMany
            : count === 1
              ? styles.layout1
              : count === 2
                ? styles.layout2
                : count === 3
                  ? styles.layout3
                  : count === 4
                    ? styles.layout4
                    : styles.layoutFlex

    const gridClass = [styles.grid, layoutClass, count === 2 && duoAlignEnds ? styles.layout2Duo : ""]
        .filter(Boolean)
        .join(" ")

    return (
        <div className={gridClass} role="list" aria-label="Участники звонка" data-count={count}>
            {participants.map((p) => {
                const isSelf = !!p.isSelf
                const canVolume = !isSelf && onParticipantContextMenu != null
                const TileTag = canVolume ? "button" : "div"

                return (
                    <TileTag
                        key={p.id}
                        type={canVolume ? "button" : undefined}
                        className={[styles.tile, isSelf ? styles.tileSelf : "", canVolume ? styles.tileInteractive : ""]
                            .filter(Boolean)
                            .join(" ")}
                        role="listitem"
                        onContextMenu={
                            canVolume ? (e) => onParticipantContextMenu(e, p.username) : undefined
                        }
                        title={canVolume ? `${p.username} — ПКМ: громкость` : undefined}
                    >
                        <CallUser
                            name={p.username}
                            avatarUrl={p.avatarUrl ?? null}
                            avatarEffect={p.avatarEffect ?? "none"}
                            roleLabel={isSelf ? "Вы" : undefined}
                        />
                    </TileTag>
                )
            })}
        </div>
    )
}
