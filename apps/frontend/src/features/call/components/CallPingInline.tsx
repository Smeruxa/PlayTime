import { classifyPing } from "../../../webrtc/callPing"
import styles from "../CallPanel.module.css"

type Props = {
    rttMs: number
    peerCount: number
}

const LEVEL_LABEL: Record<ReturnType<typeof classifyPing>, string> = {
    good: "Отличное соединение",
    ok: "Нормальная задержка",
    warn: "Повышенная задержка",
    bad: "Высокая задержка",
    unknown: "Измерение…"
}

export function CallPingInline({ rttMs, peerCount }: Props) {
    const level = classifyPing(rttMs)
    const title =
        peerCount > 1
            ? `${LEVEL_LABEL[level]} · макс. ${rttMs} ms (${peerCount} участ.)`
            : `${LEVEL_LABEL[level]} · ${rttMs} ms`

    return (
        <span
            className={`${styles.pingInline} ${styles[`pingInline_${level}`]}`}
            title={title}
            aria-label={title}
        >
            {rttMs} ms
        </span>
    )
}
