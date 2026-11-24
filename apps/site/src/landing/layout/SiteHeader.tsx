import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useLatestReleases } from "../../hooks/useLatestReleases"
import { PlayTimeLogo } from "../brand/PlayTimeLogo"
import s from "./SiteHeader.module.css"

const base = import.meta.env.BASE_URL

const links = [
    { href: `${base}#mission`, label: "О продукте" },
    { href: `${base}#features`, label: "Возможности" },
    { href: `${base}#pricing`, label: "Тарифы" },
    { href: `${base}#privacy`, label: "Приватность" },
] as const

export function SiteHeader() {
    const [scrolled, setScrolled] = useState(false)
    const { heroUrl } = useLatestReleases()

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 24)
        onScroll()
        window.addEventListener("scroll", onScroll, { passive: true })
        return () => window.removeEventListener("scroll", onScroll)
    }, [])

    return (
        <header className={`${s["site-header"]}${scrolled ? ` ${s["site-header--scrolled"]}` : ""}`}>
            <div className={s["site-header__inner"]}>
                <Link to="/" className={s["site-header__logo"]}>
                    <PlayTimeLogo size={24} />
                </Link>
                <nav className={s["site-header__nav"]} aria-label="Разделы сайта">
                    <div className={s["site-header__nav-pill"]}>
                        {links.map(({ href, label }) => (
                            <a key={href} href={href} className={s["site-header__link"]}>
                                {label}
                            </a>
                        ))}
                    </div>
                </nav>
                <a className={`btn btn--primary btn--sm ${s["site-header__cta"]}`} href={heroUrl ?? "#download"}>
                    Скачать
                </a>
            </div>
        </header>
    )
}
