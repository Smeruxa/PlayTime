import { IconMicOff, IconPhone, IconPhoneHangup, IconScreen } from "../../icons/PlayTimeIcons"
import styles from "../ShowcaseSection.module.css"

export function VoicePreview() {
    return (
        <div className={styles.preview}>
            <div className={styles.voiceHeader}>
                <span>
                    <span className={styles.roomTag}>#</span> Команда
                </span>
                <span className={styles.voiceLive}>
                    <IconPhone size={12} /> В эфире
                </span>
            </div>
            <div className={styles.voiceStage}>
                <div className={styles.voiceWave} aria-hidden />
                <div className={styles.voiceAvatars}>
                    <span>А</span>
                    <span>М</span>
                    <span>И</span>
                </div>
                <p className={styles.voiceCount}>3 участника в эфире</p>
            </div>
            <div className={styles.voiceControls}>
                <span className={styles.voiceBtn}>
                    <IconMicOff size={16} />
                </span>
                <span className={styles.voiceBtn}>
                    <IconScreen size={16} />
                </span>
                <span className={`${styles.voiceBtn} ${styles.voiceBtnHangup}`}>
                    <IconPhoneHangup size={16} />
                </span>
            </div>
        </div>
    )
}
