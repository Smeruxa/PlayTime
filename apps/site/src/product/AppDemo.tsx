import { useEffect, useRef, useState } from "react"
import { IoCheckmarkDoneOutline } from "react-icons/io5"
import {
    FaAddressCard,
    FaCog,
    FaEnvelope,
    FaPlusSquare,
    FaSignOutAlt,
    FaUsers,
} from "react-icons/fa"
import { Button } from "../../../frontend/src/ui/primitives/Button"
import { Avatar } from "../../../frontend/src/ui/primitives/Avatar"
import { SearchField } from "../../../frontend/src/ui/primitives/SearchField"
import { ChatListItem } from "../../../frontend/src/ui/chat/ChatListItem"
import AppCallDemo from "./AppCallDemo"
import rail from "../../../frontend/src/ui/layout/IconRail.module.css"
import list from "../../../frontend/src/ui/layout/ConversationList.module.css"
import header from "../../../frontend/src/ui/chat/ChatHeader.module.css"
import bubble from "../../../frontend/src/ui/chat/MessageBubble.module.css"
import composer from "../../../frontend/src/ui/chat/ComposerShell.module.css"
import titlebar from "../../../frontend/src/components/Titlebar/Titlebar.module.css"
import {
    IconEnvelope,
    IconPhone,
    IconScreen,
    IconSend,
    IconUsers,
} from "../landing/icons/PlayTimeIcons"

const modes = [
    { id: "chat", label: "Чаты", icon: IconEnvelope },
    { id: "voice", label: "Звонки", icon: IconPhone },
    { id: "screen", label: "Демонстрация экрана", icon: IconScreen },
] as const
type Mode = (typeof modes)[number]["id"]
const rooms = [
    { name: "Команда", preview: "Зайду с демонстрацией", from: "Даня" },
    { name: "Дизайн", preview: "Макеты готовы", from: "Маша" },
]

export default function AppDemo({ initialMode = "chat" }: { initialMode?: Mode }) {
    const [mode, setMode] = useState<Mode>(initialMode)
    const [mic, setMic] = useState(true)
    const [query, setQuery] = useState("")
    const [selected, setSelected] = useState("Команда")
    const [draft, setDraft] = useState("")
    const [messages, setMessages] = useState<{ room: string; text: string }[]>([])
    const thread = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (thread.current) thread.current.scrollTop = thread.current.scrollHeight
    }, [messages])
    const matches = (name: string) => name.toLowerCase().includes(query.toLowerCase())

    return (
        <div className="draft-demo-wrap" id="demo" data-demo-enter>
            <div className="draft-demo-tabs" role="tablist" aria-label="Попробовать PlayTime">
                {modes.map(({ id, label, icon: Icon }, index) => (
                    <Button
                        key={id}
                        variant={mode === id ? "secondary" : "ghost"}
                        role="tab"
                        id={`tab-${id}`}
                        aria-controls="demo-panel"
                        aria-selected={mode === id}
                        tabIndex={mode === id ? 0 : -1}
                        onClick={() => setMode(id)}
                        onKeyDown={(event) => {
                            const next =
                                event.key === "ArrowRight"
                                    ? (index + 1) % 3
                                    : event.key === "ArrowLeft"
                                      ? (index + 2) % 3
                                      : event.key === "Home"
                                        ? 0
                                        : event.key === "End"
                                          ? 2
                                          : -1
                            if (next < 0) return
                            event.preventDefault()
                            setMode(modes[next].id)
                            event.currentTarget.parentElement
                                ?.querySelectorAll<HTMLButtonElement>("button")
                                [next]?.focus()
                        }}
                    >
                        <Icon size={16} />
                        {label}
                    </Button>
                ))}
            </div>
            <div
                className="app-demo"
                data-mode={mode}
                role="tabpanel"
                id="demo-panel"
                aria-labelledby={`tab-${mode}`}
            >
                <div className={titlebar.titlebar}>
                    <div className={titlebar.titleWrapper}>
                        <img
                            className={titlebar.titleImage}
                            src={`${import.meta.env.BASE_URL}assets/PlayTime.png`}
                            alt=""
                        />
                        <span className={titlebar.title}>PlayTime</span>
                    </div>
                    <span className="app-demo-label">Демонстрация интерфейса</span>
                    <div className="app-demo-window-glyphs" aria-hidden="true">
                        — <span>□</span> ×
                    </div>
                </div>
                <div className="app-demo-body">
                    <aside className={`${rail.rail} app-demo-rail`} aria-label="Панель PlayTime">
                        <div className={rail.nav}>
                            {[FaEnvelope, FaAddressCard, FaUsers, FaPlusSquare].map((Icon, i) => (
                                <span
                                    key={i}
                                    className={`${rail.navBtn} ${i === 0 ? "app-demo-rail-selected" : ""}`}
                                    aria-hidden="true"
                                >
                                    <Icon size={18} />
                                </span>
                            ))}
                        </div>
                        <div className={rail.footer}>
                            <span className={rail.navBtn} aria-hidden="true">
                                <FaCog size={18} />
                            </span>
                            <span className={rail.navBtn} aria-hidden="true">
                                <FaSignOutAlt size={18} />
                            </span>
                        </div>
                    </aside>
                    <aside
                        className={`${list.column} app-demo-sidebar`}
                        aria-label="Демонстрационный список чатов"
                    >
                        <div className={list.searchWrap}>
                            <SearchField
                                value={query}
                                onChange={setQuery}
                                placeholder="Поиск в диалогах"
                                aria-label="Поиск в демонстрационных диалогах"
                            />
                        </div>
                        <div className={list.listScroll}>
                            <span className={list.sectionTitle}>Комнаты</span>
                            {rooms
                                .filter(({ name }) => matches(name))
                                .map(({ name, preview, from }) => (
                                    <ChatListItem
                                        key={name}
                                        name={name}
                                        isRoom
                                        selected={selected === name}
                                        lastPreview={{ from, content: preview }}
                                        onClick={() => setSelected(name)}
                                    />
                                ))}
                            <span className={list.sectionTitle}>Диалоги</span>
                            {["Маша", "Даня", "Саша"].filter(matches).map((name) => (
                                <ChatListItem
                                    key={name}
                                    name={name}
                                    isRoom={false}
                                    selected={selected === name}
                                    online
                                    lastPreview={{
                                        from: name,
                                        content: name === "Маша" ? "Созвонимся?" : "На связи",
                                    }}
                                    onClick={() => setSelected(name)}
                                />
                            ))}
                            {![...rooms.map((r) => r.name), "Маша", "Даня", "Саша"].some(
                                matches
                            ) && <p className={list.empty}>Ничего не найдено</p>}
                        </div>
                    </aside>
                    <div className="app-demo-main">
                        {mode !== "chat" && (
                            <AppCallDemo
                                sharing={mode === "screen"}
                                room={rooms.some((room) => room.name === selected)}
                                selected={selected}
                                mic={mic}
                                toggleMic={() => setMic((value) => !value)}
                                toggleScreen={() => setMode(mode === "screen" ? "voice" : "screen")}
                                end={() => setMode("chat")}
                            />
                        )}
                        <header className={header.chatHeader}>
                            <div className={`${header.chatHeaderTop} app-demo-chat-head`}>
                                <Avatar
                                    name={selected}
                                    isRoom={rooms.some((r) => r.name === selected)}
                                    size="sm"
                                />
                                <span className={header.chatHeaderTitle}>{selected}</span>
                                <button
                                    type="button"
                                    className="app-demo-header-action"
                                    aria-label="Открыть демо звонка"
                                    onClick={() => setMode("voice")}
                                >
                                    <IconPhone size={18} />
                                </button>
                                <IconUsers size={18} />
                            </div>
                        </header>
                        <>
                            <div
                                className={`${bubble.messageTheme} app-demo-messages`}
                                ref={thread}
                                aria-label="Демонстрационная переписка"
                            >
                                <div className="app-demo-date">Сегодня</div>
                                {[
                                    {
                                        name: rooms.some((room) => room.name === selected)
                                            ? "Маша"
                                            : selected,
                                        text:
                                            selected === "Дизайн"
                                                ? "Макеты готовы. Покажем команде?"
                                                : "Привет! Собираемся обсудить новую идею?",
                                        mine: false,
                                    },
                                    {
                                        name: rooms.some((room) => room.name === selected)
                                            ? "Даня"
                                            : selected,
                                        text: "Я на месте. Зайду с демонстрацией экрана 👋",
                                        mine: false,
                                    },
                                    {
                                        name: "Вы",
                                        text: "Отлично, давайте созвонимся!",
                                        mine: true,
                                    },
                                    ...messages
                                        .filter((message) => message.room === selected)
                                        .map((message) => ({
                                            name: "Вы",
                                            text: message.text,
                                            mine: true,
                                        })),
                                ].map(({ name, text, mine }, i) => (
                                    <div
                                        className={`${bubble.msgRow} ${mine ? bubble.msgRowMine : bubble.msgRowOther}`}
                                        key={i}
                                    >
                                        <div className={bubble.bubbleCol}>
                                            {!mine &&
                                                rooms.some((room) => room.name === selected) && (
                                                    <span className={bubble.roomAuthor}>
                                                        {name}
                                                    </span>
                                                )}
                                            <div
                                                className={`${bubble.bubble} ${mine ? bubble.bubbleMine : bubble.bubbleOther}`}
                                            >
                                                <div className={bubble.bubbleText}>{text}</div>
                                                <div className={bubble.bubbleMeta}>
                                                    <time className={bubble.bubbleTime}>
                                                        {i > 2 ? "сейчас" : `14:${32 + i}`}
                                                    </time>
                                                    {mine && (
                                                        <IoCheckmarkDoneOutline
                                                            className={bubble.tickIcon}
                                                            aria-label="Прочитано"
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <form
                                className={composer.inputBody}
                                onSubmit={(event) => {
                                    event.preventDefault()
                                    if (!draft.trim()) return
                                    setMessages((previous) => [
                                        ...previous.slice(-19),
                                        { room: selected, text: draft.trim() },
                                    ])
                                    setDraft("")
                                }}
                            >
                                <div className={composer.composerRow}>
                                    <input
                                        className={composer.composerInput}
                                        aria-label="Сообщение в демонстрационном чате"
                                        placeholder="Напишите сообщение…"
                                        value={draft}
                                        onChange={(event) => setDraft(event.target.value)}
                                        maxLength={280}
                                    />
                                    <button
                                        className={composer.sendButton}
                                        type="submit"
                                        disabled={!draft.trim()}
                                        aria-label="Отправить сообщение в демо"
                                    >
                                        <IconSend size={17} />
                                    </button>
                                </div>
                            </form>
                        </>
                    </div>
                </div>
            </div>
            <p className="draft-demo-caption">
                <span>
                    {mode === "chat"
                        ? "Демо-сообщения остаются только на этой странице."
                        : "Пример интерфейса: звонок не выполняется, микрофон и экран не захватываются."}
                </span>
            </p>
        </div>
    )
}
