import styles from "./ProfileButton.module.css"
import { FaArrowRight } from "react-icons/fa"

interface ProfileButtonProps {
    username: string | null;
    onClick?: void;
    className?: string;
}

export default function ProfileButton({ username, onClick, className }: ProfileButtonProps) {
    return (
        <span className={`${styles.profileName} ${className || ""}`} onClick={onClick ?? (() => {})}>
            <span className={styles.username}>{username || "Unknown"}</span>
            <span className={styles.arrow}><FaArrowRight /></span>
        </span>
    )
}