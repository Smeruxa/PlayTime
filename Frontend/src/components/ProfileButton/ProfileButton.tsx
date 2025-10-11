import styles from "./ProfileButton.module.css"
import { FaArrowRight } from "react-icons/fa"

interface ProfileButtonProps {
    username: string | null;
    onClick?: void;
}

export default function ProfileButton({ username, onClick }: ProfileButtonProps) {
    return (
        <span className={styles.profileName} onClick={onClick ?? (() => {})}>
            <span className={styles.username}>{username || "Unknown"}</span>
            <span className={styles.arrow}><FaArrowRight /></span>
        </span>
    )
}