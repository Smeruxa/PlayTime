import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { FiArrowRight } from "react-icons/fi"
import { IconCheck } from "../landing/icons/PlayTimeIcons"
import { getApiBase } from "../config/apiBase"
import { TextAccent } from "../../../frontend/src/ui/primitives/TextAccent"
import { AppearancePlans, type AppearancePlan } from "./AppearancePlans"
import { formatMonthlyPlanPrice } from "./planPricing"
import PlanSignal from "./PlanSignal"
import { useBillingCatalog } from "../billing/useBillingCatalog"
import { formatAmount } from "../billing/billingApi"

type Plan = AppearancePlan & {
    slug: string
    displayName: string
    limits: {
        maxRoomMembers: number
        maxPartySockets: number
        maxVoiceMessageSec: number
        maxScreenBroadcastFps: number
    }
}

export default function ProductPricingSection() {
    const { catalog } = useBillingCatalog()
    const [plans, setPlans] = useState<Plan[]>([])
    const [failed, setFailed] = useState(false)
    useEffect(() => {
        const controller = new AbortController()
        fetch(`${getApiBase()}/subscription/plans`, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error("Plans unavailable")
                const body = (await response.json()) as { plans: Plan[] }
                setPlans(body.plans)
            })
            .catch(() => {
                if (!controller.signal.aborted) setFailed(true)
            })
        return () => controller.abort()
    }, [])
    return (
        <section className="draft-section draft-plans" id="plans">
            <div className="draft-section-head">
                <h2>
                    Начните бесплатно.
                    <br />
                    <span>Выберите лимиты под свою команду.</span>
                </h2>
                <p>
                    Free включает чаты, звонки и демонстрацию экрана. Расширенные планы подойдут,
                    если вам нужны большие комнаты и выше качество трансляции.
                </p>
            </div>
            <div className="draft-plan-grid">
                {plans.map((plan, index) => {
                    const quote = catalog?.plans.find((item) => item.slug === plan.slug)
                    const price = quote ? formatAmount(quote) : formatMonthlyPlanPrice(plan.slug)
                    return (
                        <article
                            className={`draft-plan ${plan.slug === "pro" ? "is-featured" : ""}`}
                            key={plan.slug}
                        >
                            <div className="draft-plan-top">
                                <span>
                                    <PlanSignal level={index} />
                                    {plan.displayName}
                                </span>
                            </div>
                            <h3
                                className="draft-plan-price"
                                aria-label={quote ? `${price} /мес.` : price}
                            >
                                {quote ? (
                                    <>
                                        {price} <span>/мес.</span>
                                    </>
                                ) : (
                                    price
                                )}
                            </h3>
                            <p>
                                {
                                    (
                                        {
                                            free: "Для себя и близких",
                                            medium: "Для своей компании",
                                            pro: "Для увлечённой команды",
                                            enterprise: "Для больших сообществ",
                                        } as Record<string, string>
                                    )[plan.slug]
                                }
                            </p>
                            <ul>
                                {plan.slug !== "free" ? (
                                    <li>
                                        <IconCheck size={16} />
                                        Комнаты до {plan.limits.maxRoomMembers} участников
                                    </li>
                                ) : null}
                                <li>
                                    <IconCheck size={16} />
                                    {plan.slug === "free"
                                        ? `Комнаты до ${plan.limits.maxRoomMembers} участников`
                                        : `Демонстрация до ${plan.limits.maxScreenBroadcastFps} кадров/с`}
                                </li>
                                <li>
                                    <IconCheck size={16} />
                                    До {plan.limits.maxPartySockets} участников в эфире
                                </li>
                                <li>
                                    <IconCheck size={16} />
                                    Голосовые до {plan.limits.maxVoiceMessageSec} секунд
                                </li>
                                <li>
                                    <IconCheck size={16} />
                                    {plan.slug === "free" ? (
                                        <>
                                            Две рамки и <TextAccent>Тихий свет</TextAccent>
                                        </>
                                    ) : plan.slug === "medium" ? (
                                        "Все рамки и свой баннер"
                                    ) : (
                                        "Все эффекты и наклейки"
                                    )}
                                </li>
                            </ul>
                            {plan.slug === "free" ? (
                                <a href="#download">
                                    Начать общаться <FiArrowRight aria-hidden="true" />
                                </a>
                            ) : (
                                <Link to={`/checkout?plan=${encodeURIComponent(plan.slug)}`}>
                                    Купить {plan.displayName} <FiArrowRight aria-hidden="true" />
                                </Link>
                            )}
                        </article>
                    )
                })}
            </div>
            {catalog?.mode === "test" ? (
                <p className="draft-plans-status">
                    Тестовая оплата: деньги не списываются. Один календарный месяц.
                </p>
            ) : catalog?.enabled && catalog.mode === "live" ? (
                <p className="draft-plans-status">
                    Разовая оплата за один календарный месяц. Без автопродления.
                </p>
            ) : null}
            <AppearancePlans plans={plans} />
            {!plans.length && (
                <p className="draft-plans-status">
                    {failed
                        ? "Тарифы временно недоступны. Условия можно уточнить в Telegram."
                        : "Загружаем актуальные условия…"}
                </p>
            )}
        </section>
    )
}
