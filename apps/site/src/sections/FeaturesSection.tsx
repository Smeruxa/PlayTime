import { useRef } from "react"
import {
    IconEnvelope,
    IconMic,
    IconPlusSquare,
    IconScreen,
    IconSend,
    IconShield,
    IconUsers,
} from "../landing/icons/PlayTimeIcons"
import { useScrollReveal } from "../hooks/useScrollReveal"
import s from "./FeaturesSection.module.css"

type Card = {
    k: string
    title: string
    text: string
    bullets: string[]
    icon: typeof IconEnvelope
    wide?: boolean
}

const cards: Card[] = [
    {
        k: "Приватность",
        icon: IconShield,
        title: "Личные разговоры",
        text: "Диалоги один на один — только для вас двоих.",
        bullets: ["Отдельный раздел Диалоги", "Статус в сети", "История переписки"],
        wide: true,
    },
    {
        k: "Комнаты",
        icon: IconPlusSquare,
        title: "Общий чат команды",
        text: "Комната для проекта или компании друзей.",
        bullets: ["Приглашения участников", "Реакции на сообщения", "Закреплённые сообщения"],
    },
    {
        k: "Голос",
        icon: IconMic,
        title: "Звонки и эфир",
        text: "Личный созвон или группа в комнате.",
        bullets: ["Групповой эфир", "Без отдельного приложения", "Управление микрофоном"],
    },
    {
        k: "Экран",
        icon: IconScreen,
        title: "Совместная работа",
        text: "Покажите экран во время разговора.",
        bullets: ["Демонстрация рабочего стола", "Мини-превью эфира", "В том же окне"],
    },
    {
        k: "Люди",
        icon: IconUsers,
        title: "Друзья и профили",
        text: "Контакты, аватары и статусы.",
        bullets: ["Список друзей", "Профиль с баннером", "Статусы активности"],
    },
    {
        k: "Приложение",
        icon: IconSend,
        title: "Mac и Windows",
        text: "Отдельное окно на рабочем столе.",
        bullets: ["Не теряется во вкладках", "Автообновления", "Быстрый запуск"],
    },
]

function BentoCard({ card }: { card: Card }) {
    const Icon = card.icon
    return (
        <article
            className={`${s.card}${card.wide ? ` ${s.cardWide}` : ""}`}
            data-reveal
        >
            <div className={s.cardTop}>
                <span className={s.icon} aria-hidden>
                    <Icon size={16} />
                </span>
                <p className={s.kicker}>{card.k}</p>
            </div>
            <h3 className={s.title}>{card.title}</h3>
            <p className={s.text}>{card.text}</p>
            <ul className={s.bullets}>
                {card.bullets.map((b) => (
                    <li key={b}>{b}</li>
                ))}
            </ul>
        </article>
    )
}

export function FeaturesSection() {
    const ref = useRef<HTMLElement | null>(null)
    useScrollReveal(ref, { selector: "[data-reveal]", stagger: 0.05, y: 20 })

    return (
        <section ref={ref} className={`section ${s.section}`} id="features" aria-labelledby="feat-h">
            <div className={`section__inner section--center`}>
                <p className="eyebrow section__label" data-reveal>
                    Возможности
                </p>
                <h2 id="feat-h" data-reveal>
                    Всё для общения — в одном приложении
                </h2>
                <p className="lead" data-reveal>
                    От быстрого сообщения до группового созвона.{" "}
                    <a href="#pricing">Тарифы</a> — ниже на странице.
                </p>
            </div>
            <div className={s.bento}>
                {cards.map((c) => (
                    <BentoCard key={c.title} card={c} />
                ))}
            </div>
        </section>
    )
}
