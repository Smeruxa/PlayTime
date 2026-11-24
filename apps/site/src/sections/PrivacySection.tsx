import { Link } from "react-router-dom"
import { useRef } from "react"
import { useScrollReveal } from "../hooks/useScrollReveal"
import s from "./PrivacySection.module.css"

export function PrivacySection() {
    const ref = useRef<HTMLElement | null>(null)
    useScrollReveal(ref, { stagger: 0.08, y: 20 })

    return (
        <section ref={ref} className={`section section--center ${s.section}`} id="privacy" aria-labelledby="priv-h">
            <div className={s.inner}>
                <p className="eyebrow section__label" data-reveal>
                    Конфиденциальность
                </p>
                <h2 id="priv-h" className={`${s.title} display`} data-reveal>
                    Ваши разговоры — ваше дело
                </h2>
                <p className={s.lead} data-reveal>
                    Личные диалоги доступны только вам и собеседнику. Мы не читаем переписку и не
                    используем её для рекламы.
                </p>
                <p className={s.note} data-reveal>
                    В комнатах доступ настраиваете вы — приглашайте только тех, кому доверяете.
                </p>
                <p className={s.note} data-reveal>
                    <Link to="/legal/privacy">Политика конфиденциальности</Link>
                    {" · "}
                    <Link to="/legal/terms">Пользовательское соглашение</Link>
                </p>
            </div>
        </section>
    )
}
