import styles from "./Profile.module.css"
import { FaHandHoldingUsd, FaSignOutAlt } from "react-icons/fa"

interface ProfileProps {
    username?: string | null;
    onDonate: () => void;
    onOut: () => void;
}

export default function Profile({ username, onDonate, onOut }: ProfileProps) {
    return (
        <div className={styles.body}>
            <div className={styles.left}>
                <div className={styles.circle}></div>
            </div>
            <div className={styles.right}>
                <div className={styles.naming}>
                    <span>{username || "Unknown"}</span>
                    <span>Онлайн</span>
                </div>
                <div className={styles.icons}>
                    <FaHandHoldingUsd className={styles.icon} onClick={onDonate} />
                    <FaSignOutAlt className={styles.icon} onClick={onOut} />
                </div>
            </div>
        </div>
    )
}