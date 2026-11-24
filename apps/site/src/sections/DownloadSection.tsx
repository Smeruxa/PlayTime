import { useRef } from "react"
import { useLatestReleases } from "../hooks/useLatestReleases"
import { useScrollReveal } from "../hooks/useScrollReveal"
import s from "./DownloadSection.module.css"

const cards = [
    { key: "darwin" as const, name: "macOS", hint: "Для Mac с Apple Silicon (M1 и новее)." },
    { key: "win32" as const, name: "Windows", hint: "Для ПК с Windows." },
]

export function DownloadSection() {
    const ref = useRef<HTMLElement | null>(null)
    useScrollReveal(ref, { stagger: 0.1, y: 24 })
    const { data, loading, error, formatFileSize } = useLatestReleases()

    return (
        <div className={s.downloadWrap} id="download">
            <section ref={ref} className={`section section--center ${s.download}`} aria-labelledby="dl-h">
            <div className="section__inner">
                <p className="eyebrow section__label" data-reveal>
                    Загрузка
                </p>
                <h2 id="dl-h" data-reveal>
                    Скачайте PlayTime
                </h2>
                <p className="lead" data-reveal>
                    Бесплатно для Mac и Windows. Установка занимает пару минут.
                </p>
            </div>
            <ul className={s.download__grid}>
                {cards.map(({ key, name, hint }) => {
                    const rel = data?.releases[key]
                    const href = rel?.url
                    return (
                        <li key={key} className={s.download__card} data-reveal>
                            <p className={`${s.download__platform} display`}>{name}</p>
                            {loading && <p className={s.download__detail}>Загрузка…</p>}
                            {!loading && rel && (
                                <>
                                    <p className={s.download__detail}>
                                        v{rel.version}
                                        {rel.fileSize ? ` · ${formatFileSize(rel.fileSize)}` : ""}
                                    </p>
                                    <a
                                        className={`btn btn--primary ${s.download__btn}`}
                                        href={href}
                                        download={rel.filename}
                                    >
                                        Скачать
                                    </a>
                                </>
                            )}
                            {!loading && !rel && (
                                <p className={s.download__detail}>
                                    {error ? "Ссылка недоступна." : "Скоро."}
                                </p>
                            )}
                            <p className={s.download__hint}>{hint}</p>
                            {key === "darwin" && (
                                <p className={s.download__hint}>
                                    Перенесите PlayTime в Программы. Если macOS блокирует первый запуск,
                                    откройте Системные настройки → Конфиденциальность и безопасность →
                                    Все равно открыть.
                                    {" "}<a href="https://support.apple.com/ru-ru/102445" target="_blank" rel="noreferrer">Инструкция Apple</a>
                                </p>
                            )}
                        </li>
                    )
                })}
            </ul>
            <p className={s.download__footnote} data-reveal>
                Новые версии подтягиваются автоматически.
            </p>
            </section>
        </div>
    )
}
