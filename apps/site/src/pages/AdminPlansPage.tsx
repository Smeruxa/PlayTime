import { useEffect, useState } from "react"
import { AdminLayout } from "../admin/AdminLayout"
import { getApiBase } from "../config/apiBase"
import { formatMonthlyPlanPrice } from "../product/planPricing"
import styles from "./AdminPage.module.css"
import {
    allowedAvatarEffects,
    allowedBannerEffects,
} from "../../../shared/subscription/profileCustomization"

type Plan = {
    slug: string
    displayName: string
    limits: {
        maxRoomMembers: number
        maxPartySockets: number
        maxVoiceMessageSec: number
        maxScreenBroadcastFps: number
        maxAttachmentBytes: number
        profileBannerAllowed: boolean
        profileBannerEffectsAllowed: boolean
        avatarEffectsAllowed: boolean
        profileAvatarEffectIds?: readonly string[]
        profileBannerEffectIds?: readonly string[]
    }
}
const fields: { label: string; value: (limits: Plan["limits"], slug: string) => string | number }[] = [
    { label: "Стоимость", value: (_limits, slug) => formatMonthlyPlanPrice(slug) },
    { label: "Участников в комнате", value: (l) => l.maxRoomMembers },
    { label: "Участников в голосе", value: (l) => l.maxPartySockets },
    { label: "Длина голосового сообщения", value: (l) => `${l.maxVoiceMessageSec} сек` },
    {
        label: "Файл в сообщении",
        value: (l) =>
            l.maxAttachmentBytes < 1024 ** 2
                ? `${l.maxAttachmentBytes / 1024} КБ`
                : `${l.maxAttachmentBytes / 1024 ** 2} МБ`,
    },
    { label: "Демонстрация экрана", value: (l) => `${l.maxScreenBroadcastFps} FPS` },
    { label: "Баннер профиля", value: (l) => (l.profileBannerAllowed ? "Да" : "—") },
    { label: "Эффекты баннера", value: (l) => allowedBannerEffects(l).length - 1 },
    { label: "Эффекты аватара", value: (l) => allowedAvatarEffects(l).length - 1 },
    { label: "Наклейки на баннер", value: (l) => (l.profileBannerEffectsAllowed ? "Да" : "—") },
]
export default function AdminPlansPage() {
    const [plans, setPlans] = useState<Plan[]>([])
    const [error, setError] = useState<string | null>(null)
    const [selected, setSelected] = useState("free")
    useEffect(() => {
        const controller = new AbortController()
        void fetch(`${getApiBase()}/subscription/plans`, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error()
                const body = (await response.json()) as { plans: Plan[] }
                setPlans(body.plans)
            })
            .catch(() => {
                if (!controller.signal.aborted) setError("Не удалось загрузить тарифы.")
            })
        return () => controller.abort()
    }, [])
    const current = plans.find((plan) => plan.slug === selected) ?? plans[0]
    return (
        <AdminLayout title="Тарифы" subtitle="Действующие ограничения. Только просмотр.">
            {error ? (
                <p className={styles.err} role="alert">
                    {error}
                </p>
            ) : null}
            {plans.length ? (
                <>
                    <div className={`${styles.tableWrap} ${styles.desktopOnly}`}>
                        <table className={styles.dataTable} aria-label="Сравнение лимитов тарифов">
                            <thead>
                                <tr>
                                    <th>Возможность</th>
                                    {plans.map((plan) => (
                                        <th key={plan.slug}>{plan.displayName}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {fields.map((field) => (
                                    <tr key={field.label}>
                                        <td>{field.label}</td>
                                        {plans.map((plan) => (
                                            <td className={styles.numeric} key={plan.slug}>
                                                {field.value(plan.limits, plan.slug)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className={styles.mobileOnly}>
                        <label htmlFor="plan-view" className={styles.fieldCol}>
                            Тариф
                            <select
                                id="plan-view"
                                className={styles.select}
                                value={selected}
                                onChange={(e) => setSelected(e.target.value)}
                            >
                                {plans.map((plan) => (
                                    <option key={plan.slug} value={plan.slug}>
                                        {plan.displayName}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <dl className={styles.detailList}>
                            {fields.map((field) => (
                                <div key={field.label} style={{ display: "contents" }}>
                                    <dt>{field.label}</dt>
                                    <dd>{field.value(current.limits, current.slug)}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                    <p className={styles.muted} style={{ marginTop: 22 }}>
                        Тариф конкретного аккаунта можно изменить в разделе Пользователи.
                    </p>
                </>
            ) : !error ? (
                <p className={styles.muted}>Загрузка тарифов…</p>
            ) : null}
        </AdminLayout>
    )
}
