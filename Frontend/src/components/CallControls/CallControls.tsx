import { FaMicrophone, FaMicrophoneSlash, FaPhoneSlash } from "react-icons/fa"
import styles from "./CallControls.module.css"

export default function CallControls({ mic, toggleMic, end }: { mic: boolean, toggleMic: () => void, end: () => void }) {
    return (
        <div className={styles.interactions}>
            <span className={styles.iconWrapper} onClick={toggleMic}>
                {mic ? <FaMicrophone className={styles.icon}/> : <FaMicrophoneSlash className={styles.icon}/>}
            </span>
            <span className={styles.iconWrapper} onClick={end}>
                <FaPhoneSlash className={styles.icon}/>
            </span>
        </div>
    )
}