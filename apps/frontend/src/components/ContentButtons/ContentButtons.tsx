import styles from "./ContentButtons.module.css"
import { useNavigate, useLocation } from "react-router-dom"
import { FaUsers, FaAddressCard, FaPlusSquare, FaEnvelope } from "react-icons/fa"

export default function ContentButtons() {
    const navigate = useNavigate()
    const location = useLocation()

    const links = [
        { path: "/content", icon: FaEnvelope, text: "Диалоги" },
        { path: "/profile", icon: FaAddressCard, text: "Профиль" },
        { path: "/friends", icon: FaUsers, text: "Друзья" },
        { path: "/createRoom", icon: FaPlusSquare, text: "Создать комнату" }
    ]

    return (
        <div className={styles.body}>
            {links.map(({ path, icon: Icon, text }) => (
                <div
                    key={path}
                    className={`${styles.wrapper} ${location.pathname === path ? styles.active : ""}`}
                    onClick={() => navigate(path)}
                >
                    <Icon className={styles.icon} />
                    <span className={styles.text}>{text}</span>
                </div>
            ))}
        </div>
    )
}
