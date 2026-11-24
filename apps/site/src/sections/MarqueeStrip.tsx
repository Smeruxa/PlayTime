import { useRef } from "react"
import { ensureGsapPlugins, gsap, prefersReducedMotion, useGSAP } from "../animations/gsapSetup"
import s from "./MarqueeStrip.module.css"

const items = [
    { k: "Чаты", v: "команда и друзья" },
    { k: "Звонки", v: "один на один и группы" },
    { k: "Экран", v: "совместная работа" },
    { k: "Приватность", v: "личные диалоги" },
    { k: "Голосовые", v: "когда удобнее сказать" },
    { k: "Приложение", v: "Mac и Windows" },
] as const

function Row() {
    return (
        <>
            {items.map(({ k, v }) => (
                <span className={s["marquee__item"]} key={`${k}-${v}`}>
                    <strong>{k}</strong>
                    <span className={s["marquee__sep"]}>·</span>
                    {v}
                </span>
            ))}
        </>
    )
}

export function MarqueeStrip() {
    const trackRef = useRef<HTMLDivElement | null>(null)

    useGSAP(
        () => {
            const track = trackRef.current
            if (!track || prefersReducedMotion()) return
            ensureGsapPlugins()

            const width = track.scrollWidth / 2
            gsap.to(track, {
                x: -width,
                duration: 38,
                ease: "none",
                repeat: -1,
            })
        },
        { scope: trackRef }
    )

    return (
        <div className={s.marquee} aria-hidden>
            <div className={`${s["marquee__fade"]} ${s["marquee__fade--left"]}`} />
            <div className={`${s["marquee__fade"]} ${s["marquee__fade--right"]}`} />
            <div ref={trackRef} className={s["marquee__track"]}>
                <Row />
                <Row />
            </div>
        </div>
    )
}
