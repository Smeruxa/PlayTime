import { IconMic, IconPhone, IconScreen } from "../../icons/PlayTimeIcons"
import styles from "../ShowcaseSection.module.css"

export function ScreenPreview() {
    return (
        <div className={styles.preview}>
            <div className={styles.screenFrame}>
                <div className={styles.screenBar}>
                    <span className={styles.screenBarTitle}>
                        <IconScreen size={12} /> PlayTime — Команда
                    </span>
                    <span className={styles.screenBarLive}>● Live</span>
                </div>
                <div className={styles.screenBody}>
                    <div className={styles.screenContent}>
                        <span data-w="full" />
                        <span data-w="mid" />
                        <span data-w="short" />
                    </div>
                    <div className={styles.screenShareBadge}>
                        <IconScreen size={10} /> Демонстрация
                    </div>
                </div>
            </div>
            <div className={styles.screenPip}>
                <span>
                    <IconPhone size={10} /> 3 в эфире
                </span>
                <div className={styles.screenPipPreview}>
                    <span className={styles.screenPipFace} aria-hidden />
                    <span className={styles.screenPipMic} aria-hidden>
                        <IconMic size={8} />
                    </span>
                </div>
            </div>
        </div>
    )
}
