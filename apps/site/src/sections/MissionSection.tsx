import { useRef } from "react"
import { useScrollReveal } from "../hooks/useScrollReveal"
import s from "./MissionSection.module.css"

const bullets = [
    {
        t: "Одно место для общения",
        d: "Чаты, звонки и экран — без переключения между сервисами.",
    },
    {
        t: "Для команды и близких",
        d: "Общая комната для проекта или тихий разговор один на один.",
    },
    {
        t: "Когда текста мало",
        d: "Позвоните или покажите экран — всё в том же приложении.",
    },
] as const

export function MissionSection() {
    const ref = useRef<HTMLElement | null>(null)
    useScrollReveal(ref, { stagger: 0.1, y: 24 })

    return (
        <section ref={ref} className={`section ${s.section}`} id="mission" aria-labelledby="mission-h">
            <div className={s.grid}>
                <div>
                    <p className="eyebrow section__label" data-reveal>
                        О продукте
                    </p>
                    <p id="mission-h" className={s.mega} data-reveal>
                        Простой способ оставаться <em>на связи</em> — там, где вы уже работаете.
                    </p>
                </div>
                <ul className={s.list} aria-label="Подход PlayTime">
                    {bullets.map(({ t, d }) => (
                        <li key={t} data-reveal>
                            <strong>{t}</strong>
                            {d}
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    )
}
