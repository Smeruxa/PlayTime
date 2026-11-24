import { useRef } from "react"
import { FaApple, FaWindows } from "react-icons/fa"
import { IoCheckmarkDoneOutline } from "react-icons/io5"
import { ensureGsapPlugins } from "../animations/gsapSetup"
import { useLandingIntro } from "./useLandingIntro"
import { useLatestReleases } from "../hooks/useLatestReleases"
import ProductDemo from "./AppDemo"
import ProductPricingSection from "./ProductPricingSection"
import titlebar from "../../../frontend/src/components/Titlebar/Titlebar.module.css"
import button from "../../../frontend/src/ui/primitives/Button.module.css"
import {
    IconCheck,
    IconEnvelope,
    IconPhone,
    IconScreen,
    IconShield,
} from "../landing/icons/PlayTimeIcons"

const brandIcon = `${import.meta.env.BASE_URL}assets/PlayTime.png`
const webAppUrl = `${import.meta.env.BASE_URL}app/`
ensureGsapPlugins()
function Arrow({ diagonal = false }: { diagonal?: boolean }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h15m-6-6 6 6-6 6"}
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

function Brand() {
    return (
        <a className="draft-brand" href="#top" aria-label="PlayTime — наверх">
            <img src={brandIcon} alt="" width="35" height="35" />
            <span className={titlebar.title}>PlayTime</span>
        </a>
    )
}

function ConnectionBackdrop() {
    return (
        <div className="draft-connections" aria-hidden="true">
            <svg className="draft-connection-lines" viewBox="0 0 1440 620" fill="none">
                <defs>
                    <linearGradient
                        id="playtime-signal"
                        x1="80"
                        y1="100"
                        x2="1340"
                        y2="580"
                        gradientUnits="userSpaceOnUse"
                    >
                        <stop stopColor="#3aa8ff" stopOpacity="0.1" />
                        <stop offset="0.5" stopColor="#2ee7ff" stopOpacity="0.55" />
                        <stop offset="1" stopColor="#3aa8ff" stopOpacity="0.1" />
                    </linearGradient>
                </defs>
                <g stroke="url(#playtime-signal)" strokeWidth="1.2">
                    <path data-signal-wire="chat" pathLength="1000" />
                    <path data-signal-wire="call" pathLength="1000" />
                    <path data-signal-wire="screen" pathLength="1000" />
                </g>
                <g className="draft-connection-orbits" stroke="url(#playtime-signal)">
                    <ellipse pathLength="1000" cx="720" cy="650" rx="670" ry="440" />
                    <ellipse pathLength="1000" cx="720" cy="650" rx="800" ry="510" opacity="0.45" />
                </g>
            </svg>
            <span className="draft-signal-chip draft-signal-chat">
                <IconEnvelope size={32} />
            </span>
            <span className="draft-signal-chip draft-signal-call">
                <IconPhone size={30} />
            </span>
            <span className="draft-signal-chip draft-signal-screen">
                <IconScreen size={24} />
            </span>
        </div>
    )
}

function Waveform({ active = true }: { active?: boolean }) {
    return (
        <span className={`draft-wave ${active ? "is-active" : ""}`} aria-hidden="true">
            {[10, 17, 25, 14, 32, 22, 38, 28, 18, 34, 24, 14, 29, 20, 32, 16, 10].map(
                (height, i) => (
                    <i key={i} style={{ height, animationDelay: `${i * -0.12}s` }} />
                )
            )}
        </span>
    )
}

export default function ProductLandingPage() {
    const root = useRef<HTMLDivElement>(null)
    const { data, loading, error, formatFileSize } = useLatestReleases()
    useLandingIntro(root)

    return (
        <div className="draft-site" ref={root} id="top">
            <a className="draft-skip" href="#main">
                Перейти к содержимому
            </a>
            <div className="draft-hero-bg">
                <ConnectionBackdrop />
                <header className="draft-nav draft-container">
                    <Brand />
                    <nav aria-label="Основная навигация">
                        <a href="#features">Возможности</a>
                        <a href="#plans">Тарифы</a>
                        <a href="#questions">Вопросы</a>
                    </nav>
                    <a className="draft-nav-download" href={webAppUrl}>
                        Открыть в браузере
                        <Arrow diagonal />
                    </a>
                </header>
                <main id="main">
                    <section className="draft-hero draft-container" aria-labelledby="draft-title">
                        <div className="draft-hero-copy">
                            <h1 id="draft-title" data-enter>
                                Чаты, звонки
                                <br />
                                <span>и общий экран.</span>
                            </h1>
                            <p className="draft-hero-description" data-enter>
                                Обсуждайте задачи с командой и общайтесь с друзьями: пишите,
                                созванивайтесь и показывайте экран из одного приложения.
                            </p>
                            <div className="draft-hero-actions" data-enter>
                                <a
                                    className={`${button.btn} ${button.primary} draft-button`}
                                    href={webAppUrl}
                                >
                                    Открыть в браузере
                                    <Arrow diagonal />
                                </a>
                                <a className="draft-demo-link" href="#download">
                                    Скачать приложение <Arrow diagonal />
                                </a>
                            </div>
                            <p className="draft-platform-note" data-enter>
                                В браузере, на macOS и Windows
                            </p>
                        </div>
                        <ProductDemo />
                    </section>
                </main>
            </div>
            <section className="draft-section draft-container" id="features">
                <div className="draft-feature-intro">
                    <div>
                        <h2>
                            Переписывайтесь. Созванивайтесь.
                            <br />
                            <span>Решайте задачи вместе.</span>
                        </h2>
                    </div>
                    <p>
                        Выбирайте, как удобнее объяснить: сообщением, голосом или показом своего
                        экрана.
                    </p>
                </div>
                <div className="draft-features">
                    <article className="draft-feature draft-feature-chat">
                        <div className="draft-feature-kicker">
                            <span>01 / ЧАТЫ</span>
                            <IconEnvelope size={22} />
                        </div>
                        <h3>
                            Сохраняйте
                            <br />
                            договорённости.
                        </h3>
                        <p>
                            Пишите в личные диалоги и комнаты команды. Отправляйте файлы, находите
                            сообщения в истории и возвращайтесь к важному.
                        </p>
                        <div className="draft-chat-illustration" aria-hidden="true">
                            <span>Соберёмся вечером?</span>
                            <span>
                                Я с вами! <IoCheckmarkDoneOutline className="draft-read-receipt" />
                            </span>
                            <span>Тогда до встречи ☀</span>
                        </div>
                    </article>
                    <article className="draft-feature draft-feature-voice">
                        <div className="draft-feature-kicker">
                            <span>02 / ГОЛОС</span>
                            <IconPhone size={22} />
                        </div>
                        <h3>
                            Обсуждайте
                            <br />
                            голосом.
                        </h3>
                        <p>
                            Сложный вопрос проще разобрать в разговоре. Позвоните собеседнику или
                            соберите команду в голосовой комнате.
                        </p>
                        <div className="draft-voice-illustration" aria-hidden="true">
                            <span className="draft-orbit-avatar peach">М</span>
                            <Waveform />
                            <span className="draft-orbit-avatar lavender">Д</span>
                        </div>
                    </article>
                    <article className="draft-feature draft-feature-screen">
                        <div className="draft-feature-kicker">
                            <span>03 / ЭКРАН</span>
                            <IconScreen size={22} />
                        </div>
                        <h3>
                            Объясняйте
                            <br />
                            на экране.
                        </h3>
                        <p>
                            Покажите макет, документ или задачу во время звонка. Собеседники увидят
                            то, что вы обсуждаете.
                        </p>
                        <div className="draft-screen-illustration">
                            <img
                                src={`${import.meta.env.BASE_URL}assets/screen-share-preview.jpg`}
                                alt="Демонстрация экрана в PlayTime: общее окно и панель управления звонком"
                                loading="lazy"
                            />
                        </div>
                    </article>
                </div>
            </section>
            <section className="draft-privacy">
                <div className="draft-container draft-privacy-inner">
                    <div className="draft-privacy-art" aria-hidden="true">
                        <span className="draft-privacy-ring" />
                        <span className="draft-privacy-node draft-privacy-node-one">
                            <IconEnvelope size={21} />
                        </span>
                        <span className="draft-privacy-node draft-privacy-node-two">
                            <IconCheck size={19} />
                        </span>
                        <span className="draft-privacy-node draft-privacy-node-three">
                            <IconEnvelope size={16} />
                        </span>
                        <IconShield size={80} />
                        <span className="draft-private-note">
                            Только между вами <IconCheck size={13} />
                        </span>
                    </div>
                    <div>
                        <h2>
                            Личные сообщения
                            <br />
                            под защитой.
                        </h2>
                        <p>
                            Сквозное шифрование защищает личные сообщения. А в комнаты вы сами
                            приглашаете тех, с кем хотите общаться.
                        </p>
                        <a href="https://smeruxa.ru/playtime/legal/privacy">
                            О конфиденциальности
                            <Arrow diagonal />
                        </a>
                    </div>
                </div>
            </section>
            <div className="draft-container">
                <ProductPricingSection />
                <section className="draft-section draft-faq" id="questions">
                    <div>
                        <h2>
                            Вопросы <br />
                            <span>о PlayTime</span>
                        </h2>
                    </div>
                    <div className="draft-faq-list">
                        {[
                            [
                                "PlayTime — это бесплатно?",
                                "План Free бесплатный: личные чаты, комнаты, голосовые звонки и демонстрация экрана. Планы Medium, Pro и Enterprise можно оплатить через ЮKassa на один календарный месяц. Автопродления и повторных списаний нет.",
                            ],
                            [
                                "На каких компьютерах работает приложение?",
                                "PlayTime можно открыть в браузере без установки или скачать для Windows и macOS. В браузере можно смотреть демонстрации собеседников; чтобы показать свой экран, используйте приложение. Текущая macOS-сборка предназначена для Mac с Apple Silicon: M1 и новее.",
                            ],
                            [
                                "Как начать общаться?",
                                "Откройте веб-версию: для быстрого входа достаточно ника. Можно сразу зарегистрироваться или сделать это позже, сохранив свой аккаунт. Добавьте друзей, начните личный диалог или создайте комнату.",
                            ],
                            [
                                "Как долго хранится переписка?",
                                "В личном диалоге сохраняются 40 последних сообщений. Для файлов действуют квоты хранилища. Важные материалы сохраняйте отдельно, а для переноса зашифрованной переписки на другой компьютер создайте копию ключей в профиле → Аккаунт. Подробнее — в политике конфиденциальности.",
                            ],
                            [
                                "Почему macOS просит разрешить запуск?",
                                "Текущая сборка пока не нотарифицирована Apple. Перенесите PlayTime в Программы, попробуйте открыть, затем выберите Системные настройки → Конфиденциальность и безопасность → Всё равно открыть.",
                            ],
                        ].map(([question, answer]) => (
                            <details key={question}>
                                <summary>
                                    {question}
                                    <span>+</span>
                                </summary>
                                <p>{answer}</p>
                            </details>
                        ))}
                    </div>
                </section>
            </div>
            <section className="draft-download" id="download">
                <div className="draft-download-art" aria-hidden="true">
                    <span>
                        <IconEnvelope size={36} />
                    </span>
                    <span>
                        <IconPhone size={30} />
                    </span>
                    <span>
                        <IconScreen size={38} />
                    </span>
                </div>
                <div className="draft-container">
                    <div className="draft-download-top">
                        <div>
                            <h2>
                                Скачайте PlayTime
                                <br />
                                <span>для своего компьютера.</span>
                            </h2>
                        </div>
                    </div>
                    <div className="draft-download-options">
                        {(
                            [
                                {
                                    platform: "darwin",
                                    title: "Для Mac",
                                    description: "Apple Silicon · M1 и новее",
                                    icon: FaApple,
                                },
                                {
                                    platform: "win32",
                                    title: "Для Windows",
                                    description: "Установщик для Windows · x64",
                                    icon: FaWindows,
                                },
                            ] as const
                        ).map(({ platform, title, description, icon: OsIcon }) => {
                            const release = data?.releases[platform]
                            return (
                                <div className="draft-download-option" key={platform}>
                                    <span className="draft-os-symbol" aria-hidden="true">
                                        <OsIcon />
                                    </span>
                                    <div>
                                        <h3>{title}</h3>
                                        <p>{description}</p>
                                        <span className="draft-version">
                                            {release
                                                ? `v${release.version} · ${formatFileSize(release.fileSize)}`
                                                : loading
                                                  ? "Проверяем последнюю версию…"
                                                  : error
                                                    ? "Не удалось загрузить ссылку"
                                                    : "Сборка появится позже"}
                                        </span>
                                    </div>
                                    {release ? (
                                        <a
                                            href={release.url}
                                            aria-label={`Скачать PlayTime ${title}`}
                                            download={release.filename}
                                        >
                                            <Arrow diagonal />
                                        </a>
                                    ) : (
                                        <span className="draft-download-pending" aria-hidden="true">
                                            …
                                        </span>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                    <p className="draft-mac-note">
                        Первый запуск на Mac нужно разрешить в настройках безопасности.{" "}
                        <a
                            href="https://support.apple.com/ru-ru/102445"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Как это сделать ↗
                        </a>
                    </p>
                    <a className="draft-browser-option" href={webAppUrl}>
                        <IconScreen size={23} />
                        <span>
                            <strong>Без установки</strong>Откройте PlayTime прямо в браузере
                        </span>
                        <Arrow diagonal />
                    </a>
                </div>
            </section>
            <footer className="draft-footer draft-container">
                <Brand />

                <div>
                    <a href="https://t.me/smeruxa" target="_blank" rel="noreferrer">
                        Связаться ↗
                    </a>
                    <a href="https://smeruxa.ru/playtime/legal/terms">Условия</a>
                    <a href="https://smeruxa.ru/playtime/legal/privacy">Приватность</a>
                    <a href="https://smeruxa.ru/playtime/feedback">Идеи и ошибки</a>
                </div>
                <div className="draft-footer-bottom">
                    <span>© {new Date().getFullYear()} PlayTime</span>
                    <a href="#top">Наверх ↑</a>
                </div>
            </footer>
        </div>
    )
}
