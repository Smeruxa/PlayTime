import styles from "./CallParticipantsSkeleton.module.css"

type CallParticipantTileSkeletonProps = {
    delay?: number
}

export function CallParticipantTileSkeleton({ delay = 0 }: CallParticipantTileSkeletonProps) {
    return (
        <div className={styles.tile} aria-hidden>
            <div className={styles.avatar} style={{ animationDelay: `${delay}s` }} />
            <div className={styles.name} style={{ animationDelay: `${delay + 0.08}s` }} />
        </div>
    )
}

type CallParticipantsSkeletonProps = {
    count?: number
    duoAlignEnds?: boolean
}

export function CallParticipantsSkeleton({ count = 2, duoAlignEnds = false }: CallParticipantsSkeletonProps) {
    const n = Math.max(1, Math.min(count, 8))
    const layoutClass =
        n === 1
            ? styles.layout1
            : n === 2
              ? styles.layout2
              : n === 3
                ? styles.layout3
                : n === 4
                  ? styles.layout4
                  : styles.layoutFlex

    const gridClass = [styles.grid, layoutClass, n === 2 && duoAlignEnds ? styles.layout2Duo : ""]
        .filter(Boolean)
        .join(" ")

    return (
        <div className={gridClass} aria-busy="true" aria-label="Загрузка участников звонка" role="status">
            {Array.from({ length: n }, (_, i) => (
                <CallParticipantTileSkeleton key={i} delay={i * 0.1} />
            ))}
        </div>
    )
}

export function CallVolumeSkeleton() {
    return (
        <div className={styles.volumeRow} aria-hidden>
            <div className={styles.volumeIcon} />
            <div className={styles.volumeTrack} />
            <div className={styles.volumeBadge} />
        </div>
    )
}

export function CallStateSkeleton() {
    return <span className={styles.callState} aria-busy="true" aria-label="Загрузка статуса звонка" role="status" />
}

export function PartyCaptionSkeleton() {
    return (
        <div className={styles.partyCaption} aria-hidden>
            <div className={styles.partyCaptionLabel} />
            <div className={styles.partyCaptionRoom} />
        </div>
    )
}
