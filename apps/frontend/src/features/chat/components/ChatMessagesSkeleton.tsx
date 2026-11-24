import styles from "../../../ui/chat/MessageBubble.module.css"

const ROWS: { mine: boolean; lines: number[] }[] = [
    { mine: true, lines: [78, 52] },
    { mine: false, lines: [88, 66, 40] },
    { mine: true, lines: [44, 70] },
    { mine: false, lines: [92, 58] },
    { mine: true, lines: [62, 48] },
    { mine: false, lines: [76, 64, 36] },
    { mine: true, lines: [56, 68] }
]

const ROWS_COMPACT = ROWS.slice(0, 4)

export function ChatMessagesSkeleton({ compact = false }: { compact?: boolean }) {
    const rows = compact ? ROWS_COMPACT : ROWS
    return (
        <div className={styles.skeletonRoot} aria-busy="true" aria-label="Загрузка сообщений" role="status">
            {rows.map((r, i) => (
                <div key={i} className={`${styles.msgRow} ${r.mine ? styles.msgRowMine : styles.msgRowOther}`}>
                    <div className={styles.bubbleCol}>
                        <div
                            className={`${styles.skeletonBubble} ${r.mine ? styles.skeletonBubbleMine : styles.skeletonBubbleOther}`}
                        >
                            {r.lines.map((wPct, j) => (
                                <div
                                    key={j}
                                    className={styles.skeletonLine}
                                    style={{
                                        width: `${wPct}%`,
                                        animationDelay: `${i * 0.11 + j * 0.07}s`
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    )
}
