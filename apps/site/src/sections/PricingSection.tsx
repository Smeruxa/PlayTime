import { useEffect, useRef, useState } from "react"
import { getApiBase } from "../config/apiBase"
import { useScrollReveal } from "../hooks/useScrollReveal"
import { formatMonthlyPlanPrice } from "../product/planPricing"
import styles from "./PricingSection.module.css"

type PlanSlug = "free" | "medium" | "pro" | "enterprise"

type PlanRow = {
    slug: PlanSlug
    displayName: string
    limits: {
        maxRoomMembers: number
        maxPartySockets: number
        maxVoiceMessageSec: number
        maxScreenBroadcastFps: number
        profileBannerAllowed: boolean
        profileBannerEffectsAllowed?: boolean
        avatarEffectsAllowed?: boolean
        userSummary?: string
    }
}

const PITCH: Record<PlanSlug, string> = {
    free: "Для себя и небольшой компании друзей.",
    medium: "Команда, которая регулярно общается и созванивается.",
    pro: "Активные чаты и созвоны с расширенными возможностями.",
    enterprise: "Крупные команды и организации с особыми требованиями.",
}

const FEATURED: PlanSlug = "pro"

function CheckIcon() {
    return (
        <svg className={styles.checkIcon} viewBox="0 0 16 16" aria-hidden>
            <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.5 8.2 6.4 11 12.5 5"
            />
        </svg>
    )
}

function planBullets(p: PlanRow): string[] {
    const l = p.limits
    const items: string[] =
        p.slug === "free"
            ? ["Личные чаты и комнаты", "Голосовые звонки", "Демонстрация экрана", "Профиль и статусы"]
            : [
                  `Комнаты до ${l.maxRoomMembers} участников`,
                  "Групповые созвоны",
                  "Демонстрация экрана",
                  l.profileBannerAllowed ? "Оформление профиля" : "Профиль и статусы",
              ]

    if ((p.slug === "pro" || p.slug === "enterprise") && (l.profileBannerEffectsAllowed || l.avatarEffectsAllowed)) {
        items[3] = "Расширенные возможности профиля"
    }

    return items.slice(0, 4)
}

function summaryLead(text: string | undefined): string | null {
    if (!text?.trim()) return null
    const first = text.split(/\n{2,}/)[0]?.trim()
    return first || null
}

export function PricingSection() {
    const ref = useRef<HTMLElement | null>(null)
    useScrollReveal(ref, { selector: "[data-reveal]", stagger: 0.08, y: 20 })
    const [plans, setPlans] = useState<PlanRow[]>([])
    const [err, setErr] = useState<string | null>(null)

    useEffect(() => {
        const ac = new AbortController()
        ;(async () => {
            try {
                const res = await fetch(`${getApiBase()}/subscription/plans`, { signal: ac.signal })
                if (!res.ok) throw new Error("bad status")
                const body = (await res.json()) as { plans?: PlanRow[] }
                setPlans(Array.isArray(body.plans) ? body.plans : [])
                setErr(null)
            } catch {
                if (!ac.signal.aborted) setErr("Не удалось загрузить тарифы. Попробуйте позже.")
            }
        })()
        return () => ac.abort()
    }, [])

    return (
        <section ref={ref} id="pricing" className={styles.section} aria-labelledby="pricing-title">
            <div className={styles.head}>
                <p className="eyebrow section__label" data-reveal>
                    Тарифы
                </p>
                <h2 id="pricing-title" className={styles.title} data-reveal>
                    План под размер вашей команды
                </h2>
                <p className={styles.lead} data-reveal>
                    От личного общения до корпоративных комнат. Подключение — через{" "}
                    <a href="https://t.me/smeruxa" target="_blank" rel="noopener noreferrer">
                        Telegram
                    </a>
                    .
                </p>
            </div>

            {err ? <p className={styles.err}>{err}</p> : null}

            <div className={styles.grid}>
                {plans.map((p) => {
                    const featured = p.slug === FEATURED
                    const lead = summaryLead(p.limits.userSummary) ?? PITCH[p.slug]
                    return (
                        <article
                            key={p.slug}
                            className={`${styles.card}${featured ? ` ${styles.cardFeatured}` : ""}`}
                            data-reveal
                            aria-label={`Тариф ${p.displayName}`}
                        >
                            {featured ? <span className={styles.badge}>Популярный</span> : null}
                            <header className={styles.cardHead}>
                                <h3 className={styles.cardTitle}>{p.displayName}</h3>
                                <p className={styles.cardPitch}>{PITCH[p.slug]}</p>
                            </header>
                            <p className={styles.cardPrice}>{formatMonthlyPlanPrice(p.slug)}</p>
                            <ul className={styles.highlights}>
                                {planBullets(p).map((item) => (
                                    <li key={item}>
                                        <CheckIcon />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                            {lead && lead !== PITCH[p.slug] ? (
                                <p className={styles.cardNote}>{lead}</p>
                            ) : null}
                        </article>
                    )
                })}
            </div>

            <p className={styles.footnote} data-reveal>
                Цены указаны в рублях за месяц. Подключение — через Telegram.
            </p>
        </section>
    )
}
