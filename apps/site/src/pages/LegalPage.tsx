import { Link } from "react-router-dom"
import { PRIVACY_REVISION, PRIVACY_SECTIONS } from "../content/legal/privacy.ru"
import { TERMS_REVISION, TERMS_SECTIONS } from "../content/legal/terms.ru"
import styles from "./LegalPage.module.css"

type LegalPageProps = {
    kind: "terms" | "privacy"
}

export default function LegalPage({ kind }: LegalPageProps) {
    const isTerms = kind === "terms"
    const title = isTerms ? "Пользовательское соглашение" : "Политика конфиденциальности"
    const revision = isTerms ? TERMS_REVISION : PRIVACY_REVISION
    const sections = isTerms ? TERMS_SECTIONS : PRIVACY_SECTIONS
    const otherHref = isTerms ? "/legal/privacy" : "/legal/terms"
    const otherLabel = isTerms ? "Политика конфиденциальности" : "Пользовательское соглашение"

    return (
        <div className={styles.wrap}>
            <header className={styles.top}>
                <Link to="/" className={styles.back}>
                    ← PlayTime
                </Link>
                <p className={styles.meta}>Редакция от {revision}</p>
            </header>

            <article className={styles.doc}>
                <h1>{title}</h1>
                <p className={styles.lead}>
                    Документ составлен по типовой структуре для РФ и не заменяет индивидуальную юридическую
                    консультацию. Оператор — физическое лицо, правообладатель PlayTime (Telegram @smeruxa).
                </p>

                <nav className={styles.toc} aria-label="Оглавление">
                    <p className={styles.tocTitle}>Содержание</p>
                    <ol>
                        {sections.map((s) => (
                            <li key={s.id}>
                                <a href={`#${s.id}`}>{s.title}</a>
                            </li>
                        ))}
                    </ol>
                </nav>

                {sections.map((s) => (
                    <section key={s.id} id={s.id} className={styles.section}>
                        <h2>{s.title}</h2>
                        {s.body.split("\n\n").map((para, i) => (
                            <p key={i}>{para}</p>
                        ))}
                    </section>
                ))}

                <footer className={styles.footer}>
                    <Link to={otherHref}>{otherLabel}</Link>
                    <span className={styles.dot}>·</span>
                    <a href="https://t.me/smeruxa" target="_blank" rel="noopener noreferrer">
                        @smeruxa
                    </a>
                </footer>
            </article>
        </div>
    )
}
