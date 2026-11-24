import { useRef } from "react"
import { useScrollReveal } from "../hooks/useScrollReveal"
import s from "./TrustStrip.module.css"

const items = [
    {
        title: "Всегда на связи",
        text: "Сообщения и статусы обновляются мгновенно — вы видите, что происходит прямо сейчас.",
    },
    {
        title: "Личное остаётся личным",
        text: "Личные диалоги доступны только вам и собеседнику.",
    },
    {
        title: "На вашем компьютере",
        text: "Отдельное приложение для Mac и Windows — не теряется среди вкладок браузера.",
    },
] as const

export function TrustStrip() {
    const ref = useRef<HTMLElement | null>(null)
    useScrollReveal(ref, { stagger: 0.08, y: 20 })

    return (
        <section ref={ref} className={s["trust-strip"]} id="product" aria-labelledby="trust-h">
            <h2 id="trust-h" className="visually-hidden">
                Ключевые преимущества
            </h2>
            <ul className={s["trust-strip__grid"]}>
                {items.map(({ title, text }) => (
                    <li key={title} className={s["trust-strip__card"]} data-reveal>
                        <p className={s["trust-strip__title"]}>{title}</p>
                        <p className={s["trust-strip__text"]}>{text}</p>
                    </li>
                ))}
            </ul>
        </section>
    )
}
