import { useLocation, useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { FaAddressCard, FaCog, FaEnvelope, FaRegLightbulb, FaPlusSquare, FaSignOutAlt, FaUsers } from "react-icons/fa"
import styles from "./IconRail.module.css"
import { GuestReminder } from "./GuestReminder"

const LINKS = [
    { path: "/content", icon: FaEnvelope, label: "Диалоги" },
    { path: "/profile", icon: FaAddressCard, label: "Профиль" },
    { path: "/friends", icon: FaUsers, label: "Друзья" },
    { path: "/createRoom", icon: FaPlusSquare, label: "Создать комнату" }
] as const

type IconRailProps = {
    onOpenSettings: () => void
    onLogout: () => void
}

export function IconRail({ onOpenSettings, onLogout }: IconRailProps) {
    const navigate = useNavigate()
    const location = useLocation()
    const activeIndex = LINKS.findIndex((l) => l.path === location.pathname)

    return (
        <aside className={styles.rail} aria-label="Навигация">
            <nav className={styles.nav}>
                {activeIndex >= 0 ? (
                    <motion.div
                        className={styles.activePill}
                        layoutId="iconRailActive"
                        initial={false}
                        animate={{ y: activeIndex * 50 }}
                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                        style={{ top: 0 }}
                    />
                ) : null}
                {LINKS.map(({ path, icon: Icon, label }) => {
                    const active = location.pathname === path
                    return (
                        <button
                            key={path}
                            type="button"
                            className={`${styles.navBtn} ${active ? styles.navBtnActive : ""}`}
                            title={label}
                            aria-label={label}
                            aria-current={active ? "page" : undefined}
                            onClick={() => navigate(path)}
                        >
                            <Icon size={18} />
                        </button>
                    )
                })}
            </nav>
            <div className={styles.footer}>
                <GuestReminder />
                <a
                    className={styles.navBtn}
                    href="https://smeruxa.ru/playtime/feedback"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Фич-реквест: идея или ошибка"
                    aria-label="Фич-реквест: идея или ошибка"
                >
                    <FaRegLightbulb size={18} />
                </a>
                <button
                    type="button"
                    className={styles.navBtn}
                    title="Настройки"
                    aria-label="Настройки"
                    onClick={onOpenSettings}
                >
                    <FaCog size={18} />
                </button>
                <button
                    type="button"
                    className={styles.navBtn}
                    title="Выйти"
                    aria-label="Выйти из аккаунта"
                    onClick={onLogout}
                >
                    <FaSignOutAlt size={18} />
                </button>
            </div>
        </aside>
    )
}
