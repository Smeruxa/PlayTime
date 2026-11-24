import { useEffect, useState, type ReactNode } from "react"
import { Link, NavLink } from "react-router-dom"
import {
    FiActivity,
    FiFlag,
    FiInbox,
    FiArrowUpRight,
    FiClock,
    FiGrid,
    FiPackage,
    FiSliders,
    FiUsers,
    FiLogOut,
} from "react-icons/fi"
import { ADMIN_NAV } from "./adminNav"
import { useAdminSession } from "./useAdminSession"
import "../styles/admin-theme.css"
import styles from "./AdminLayout.module.css"

const icons: Record<string, typeof FiGrid> = {
    "/admin/panel": FiGrid,
    "/admin/people": FiUsers,
    "/admin/release-panel": FiPackage,
    "/admin/report-panel": FiFlag,
    "/admin/requests": FiInbox,
    "/admin/plans": FiSliders,
    "/admin/activity": FiClock,
    "/admin/system": FiActivity,
}
type Props = { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }
export function AdminLayout({ title, subtitle, actions, children }: Props) {
    const { ready, isAdmin, clientIp, accessError, logout, logoutError, isLoggingOut } =
        useAdminSession()
    const [menuOpen, setMenuOpen] = useState(false)
    useEffect(() => {
        if (!menuOpen) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setMenuOpen(false)
        }
        window.addEventListener("keydown", onKey)
        document.body.style.overflow = "hidden"
        return () => {
            window.removeEventListener("keydown", onKey)
            document.body.style.overflow = ""
        }
    }, [menuOpen])
    if (!ready)
        return (
            <div className={`adminRoot ${styles.boot}`}>
                <p className={styles.bootText}>Проверка доступа…</p>
            </div>
        )
    if (!isAdmin)
        return (
            <div className={`adminRoot ${styles.boot}`}>
                <p className={styles.err}>
                    {accessError ?? "Доступ к панели ограничен."}
                </p>
                <Link to="/admin">Перейти ко входу</Link>
            </div>
        )
    return (
        <div className={`adminRoot ${styles.shell}`}>
            <button
                type="button"
                className={`${styles.backdrop} ${menuOpen ? styles.backdropVisible : ""}`}
                aria-label="Закрыть меню"
                onClick={() => setMenuOpen(false)}
            />
            <aside
                className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}
                aria-label="Меню админки"
            >
                <div className={styles.sidebarHead}>
                    <p className={styles.brand}>
                        <img
                            src={`${import.meta.env.BASE_URL}assets/PlayTime.png`}
                            alt=""
                            className={styles.brandMark}
                        />
                        PlayTime
                    </p>
                    <p className={styles.brandSub}>Администрирование</p>
                </div>
                <nav className={styles.nav}>
                    {ADMIN_NAV.map((item) => {
                        const Icon = icons[item.to] || FiGrid
                        return (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                className={({ isActive }) =>
                                    `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`
                                }
                                onClick={() => setMenuOpen(false)}
                            >
                                <Icon size={15} aria-hidden="true" />
                                {item.label}
                            </NavLink>
                        )
                    })}
                </nav>
                <div className={styles.sidebarFoot}>
                    <p className={styles.accessLabel}>{window.location.host}</p>
                    {clientIp ? <p className={styles.ipLabel}>IP {clientIp}</p> : null}
                    <a
                        className={styles.footLink}
                        href={import.meta.env.BASE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Открыть сайт <FiArrowUpRight aria-hidden="true" />
                    </a>
                    <button
                        type="button"
                        className={styles.footLink}
                        style={{
                            background: "none",
                            border: 0,
                            color: "var(--accent)",
                            padding: 0,
                            marginTop: 14,
                            cursor: "pointer",
                        }}
                        disabled={isLoggingOut}
                        onClick={() => void logout()}
                    >
                        {isLoggingOut ? "Выходим…" : "Выйти из панели"}{" "}
                        <FiLogOut aria-hidden="true" />
                    </button>
                    {logoutError ? (
                        <p className={styles.err} role="alert">
                            {logoutError}
                        </p>
                    ) : null}
                </div>
            </aside>
            <div className={styles.main}>
                <header className={styles.header}>
                    <div className={styles.headerLeft}>
                        <button
                            type="button"
                            className={styles.menuBtn}
                            aria-expanded={menuOpen}
                            aria-label="Меню"
                            onClick={() => setMenuOpen((value) => !value)}
                        >
                            <span />
                            <span />
                            <span />
                        </button>
                        <div>
                            <h1 className={styles.pageTitle}>{title}</h1>
                            {subtitle ? <p className={styles.pageSub}>{subtitle}</p> : null}
                        </div>
                    </div>
                    {actions ? <div className={styles.headerRight}>{actions}</div> : null}
                </header>
                <main className={styles.content}>{children}</main>
            </div>
        </div>
    )
}
