import { Link } from "react-router-dom"
import s from "./FooterSection.module.css"

const TELEGRAM_URL = "https://t.me/smeruxa"
const TELEGRAM_HANDLE = "@smeruxa"

export function FooterSection() {
    return (
        <footer className={s.footer} id="connect" aria-labelledby="ft-h">
            <div className={s.inner}>
                <h2 id="ft-h" className={s.title}>
                    Начните общаться в PlayTime
                </h2>
                <p className={s.lead}>
                    Скачайте приложение, создайте комнату или напишите другу — всё в одном окне.
                </p>
            </div>
            <div className={s.btnRow}>
                <a className="btn btn--primary" href="#download">
                    Скачать
                </a>
                <a className="btn btn--accent" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                    Подписка
                </a>
                <a className="btn btn--ghost" href="#top">
                    Наверх
                </a>
            </div>
            <div className={s.legal}>
                <p className={`eyebrow ${s.brand}`}>PlayTime</p>
                <p className={s.contacts}>
                    Вопросы —{" "}
                    <a className={s.contactsLink} href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                        Telegram {TELEGRAM_HANDLE}
                    </a>
                </p>
                <p className={s.links}>
                    <Link to="/legal/terms">Соглашение</Link>
                    {" · "}
                    <Link to="/legal/privacy">Конфиденциальность</Link>
                </p>
                <p className={s.meta}>
                    © {new Date().getFullYear()} PlayTime
                </p>
            </div>
        </footer>
    )
}
