import { useEffect, useRef } from "react"
import { TextAccent } from "../../../frontend/src/ui/primitives/TextAccent"
import {
    allowedAvatarEffects,
    allowedBannerEffects,
    type ProfileCustomizationLimits,
} from "../../../shared/subscription/profileCustomization"
import { AppearanceShowcase } from "./AppearanceShowcase"
import { formatMonthlyPlanPrice } from "./planPricing"
import "./appearance-plans.css"

export type AppearancePlan = {
    slug: string
    displayName: string
    limits: ProfileCustomizationLimits & { profileBannerAllowed: boolean }
}

export function AppearancePlans({ plans }: { plans: AppearancePlan[] }) {
    const sectionRef = useRef<HTMLElement>(null)
    useEffect(() => {
        if (!plans.length || window.location.hash !== "#appearance-plans") return
        const frame = requestAnimationFrame(() =>
            sectionRef.current?.scrollIntoView({ block: "start", behavior: "instant" })
        )
        return () => cancelAnimationFrame(frame)
    }, [plans.length])
    if (!plans.length) return null
    return (
        <section
            ref={sectionRef}
            className="draft-appearance-plans"
            id="appearance-plans"
            aria-labelledby="appearance-plans-title"
        >
            <div className="draft-appearance-intro">
                <AppearanceShowcase />
                <div>
                    <p className="draft-eyebrow">Оформление профиля</p>
                    <h3 id="appearance-plans-title">На своей волне.</h3>
                    <p>
                        Две рамки аватара и едва заметный <TextAccent>Тихий свет</TextAccent> для
                        баннера — бесплатно. Medium открывает остальные рамки и загрузку своего
                        баннера. Pro добавляет всю коллекцию эффектов баннера и наклейки.
                    </p>
                </div>
            </div>
            <div
                className="draft-appearance-table-wrap"
                tabIndex={0}
                aria-label="Сравнение оформления по тарифам"
            >
                <table>
                    <thead>
                        <tr>
                            <th scope="col">Что доступно</th>
                            {plans.map((plan) => (
                                <th scope="col" key={plan.slug}>
                                    {plan.displayName}
                                    <span className="draft-appearance-plan-price">
                                        {formatMonthlyPlanPrice(plan.slug)}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <th scope="row">Рамки аватара</th>
                            {plans.map((plan) => (
                                <td key={plan.slug}>
                                    {allowedAvatarEffects(plan.limits).length - 1}
                                </td>
                            ))}
                        </tr>
                        <tr>
                            <th scope="row">Эффекты баннера</th>
                            {plans.map((plan) => (
                                <td key={plan.slug}>
                                    {allowedBannerEffects(plan.limits).length - 1}
                                </td>
                            ))}
                        </tr>
                        <tr>
                            <th scope="row">Загрузка своего баннера</th>
                            {plans.map((plan) => (
                                <td key={plan.slug}>
                                    {plan.limits.profileBannerAllowed ? "Да" : "—"}
                                </td>
                            ))}
                        </tr>
                        <tr>
                            <th scope="row">Наклейки на баннер</th>
                            {plans.map((plan) => (
                                <td key={plan.slug}>
                                    {plan.limits.profileBannerEffectsAllowed ? "Да" : "—"}
                                </td>
                            ))}
                        </tr>
                    </tbody>
                </table>
            </div>
            <p className="draft-appearance-note">
                Все выбранные эффекты видны друзьям в профиле. Рамка аватара — ещё и в переписке и
                звонках.
            </p>
        </section>
    )
}
