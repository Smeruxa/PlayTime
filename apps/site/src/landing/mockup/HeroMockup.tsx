import { useRef } from "react"
import { ensureGsapPlugins, gsap, prefersReducedMotion, useGSAP } from "../../animations/gsapSetup"
import { useCardTilt } from "../../hooks/useCardTilt"
import { PlayTimeLogo } from "../brand/PlayTimeLogo"
import {
    IconEnvelope,
    IconPhone,
    IconPlusSquare,
    IconSearch,
    IconSend,
    IconUsers,
} from "../icons/PlayTimeIcons"
import s from "./HeroMockup.module.css"

const rooms = [
    { name: "Команда", preview: "Макс: Зайду с демо", active: true },
    { name: "Дизайн", preview: "Аня: Макеты готовы" },
    { name: "Голосовой", preview: "3 в эфире" },
] as const

const dms = [
    { name: "Аня", preview: "Созвон в 15:00?", online: true },
    { name: "Игорь", preview: "Спасибо!" },
] as const

const messages = [
    { who: "Аня", text: "Созвон через 10 минут?", self: false },
    { who: "Вы", text: "Ок, экран готов", self: true },
    { who: "Макс", text: "Зайду с демонстрацией", self: false },
] as const

const railIcons = [
    { icon: IconEnvelope, active: true },
    { icon: IconUsers, active: false },
    { icon: IconPlusSquare, active: false },
] as const

function WinBtn({ kind }: { kind: "min" | "max" | "close" }) {
    return (
        <span className={`${s.winBtn} ${s[`winBtn--${kind}`]}`} aria-hidden>
            {kind === "min" ? "−" : kind === "max" ? "□" : "×"}
        </span>
    )
}

export function HeroMockup() {
    const wrapRef = useRef<HTMLDivElement | null>(null)
    const windowRef = useRef<HTMLDivElement | null>(null)
    const reduce = prefersReducedMotion()

    useCardTilt(windowRef, { maxDeg: 4, lift: 6 })

    useGSAP(
        () => {
            if (reduce || !wrapRef.current) return
            ensureGsapPlugins()

            gsap.from("[data-mock-msg]", {
                opacity: 0,
                y: 10,
                duration: 0.5,
                stagger: 0.1,
                delay: 0.6,
                ease: "power3.out",
            })

            gsap.to("[data-mock-online]", {
                opacity: 0.45,
                duration: 1.2,
                repeat: -1,
                yoyo: true,
                ease: "sine.inOut",
            })
        },
        { scope: wrapRef }
    )

    return (
        <div ref={wrapRef} className={s.mock}>
            <div className={s.mockGlow} aria-hidden />
            <div ref={windowRef} className={s.window}>
                <div className={s.titlebar}>
                    <div className={s.titleWrap}>
                        <PlayTimeLogo showWordmark={false} size={20} className={s.titleLogo} />
                        <span className={s.title}>PlayTime</span>
                    </div>
                    <div className={s.winBtns}>
                        <WinBtn kind="min" />
                        <WinBtn kind="max" />
                        <WinBtn kind="close" />
                    </div>
                </div>

                <div className={s.shell}>
                    <nav className={s.rail} aria-hidden>
                        {railIcons.map(({ icon: Icon, active }, i) => (
                            <span key={i} className={`${s.railBtn}${active ? ` ${s.railBtnActive}` : ""}`}>
                                <Icon size={18} />
                            </span>
                        ))}
                        <span className={s.railSpacer} />
                    </nav>

                    <aside className={s.list}>
                        <div className={s.search}>
                            <IconSearch size={12} />
                            Поиск в диалогах
                        </div>
                        <p className={s.listLabel}>Комнаты</p>
                        <ul className={s.listItems}>
                            {rooms.map((r) => (
                                <li
                                    key={r.name}
                                    className={`${s.listRow}${"active" in r && r.active ? ` ${s.listRowActive}` : ""}`}
                                >
                                    <span className={s.roomAvatar}>#</span>
                                    <span className={s.listRowBody}>
                                        <span className={s.listRowName}>{r.name}</span>
                                        <span className={s.listRowPreview}>{r.preview}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <p className={s.listLabel}>Диалоги</p>
                        <ul className={s.listItems}>
                            {dms.map((d) => (
                                <li key={d.name} className={s.listRow}>
                                    <span className={s.dmAvatar}>
                                        {"online" in d && d.online ? (
                                            <span data-mock-online className={s.onlineDot} aria-hidden />
                                        ) : null}
                                    </span>
                                    <span className={s.listRowBody}>
                                        <span className={s.listRowName}>{d.name}</span>
                                        <span className={s.listRowPreview}>{d.preview}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </aside>

                    <div className={s.chat}>
                        <header className={s.chatHeader}>
                            <span className={s.chatTitle}>Команда</span>
                            <div className={s.chatActions} aria-hidden>
                                <span className={s.chatAction}>
                                    <IconPhone size={14} />
                                </span>
                                <span className={s.chatAction}>
                                    <IconSearch size={14} />
                                </span>
                            </div>
                        </header>
                        <div className={s.panel}>
                            <div className={s.thread}>
                                {messages.map((m) => (
                                    <div
                                        key={m.text}
                                        data-mock-msg
                                        className={`${s.bubbleWrap}${m.self ? ` ${s.bubbleWrapSelf}` : ""}`}
                                    >
                                        {!m.self ? <span className={s.bubbleAuthor}>{m.who}</span> : null}
                                        <div className={`${s.bubble}${m.self ? ` ${s.bubbleSelf}` : ""}`}>
                                            {m.text}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <footer className={s.composer}>
                            <div className={s.composerRow}>
                                <span className={s.composerField}>Написать сообщение…</span>
                                <span className={s.sendBtn}>
                                    <IconSend size={14} />
                                </span>
                            </div>
                        </footer>
                    </div>
                </div>
            </div>
        </div>
    )
}
