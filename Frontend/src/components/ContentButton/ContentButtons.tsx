import styles from "./ContentButtons.module.css"
import { useNavigate } from "react-router-dom"
import { FaUsers, FaAddressCard } from "react-icons/fa"

export default function ContentButtons() {
    const navigate = useNavigate()

    return (
        <div className={styles.body}>
            <div className={styles.wrapper} onClick={() => navigate("/profile")}>
                <FaAddressCard className={styles.icon} />
                <span className={styles.text}>Профиль</span>
            </div>
            <div className={styles.wrapper} onClick={() => navigate("/friends")}>
                <FaUsers className={styles.icon} />
                <span className={styles.text}>Друзья</span>
            </div>
        </div>
    )
}