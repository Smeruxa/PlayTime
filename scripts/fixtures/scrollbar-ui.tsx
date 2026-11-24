import { useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import type { Socket } from "socket.io-client"
import SettingsModal from "../../apps/frontend/src/components/SettingsModal/SettingsModal"
import FriendsPage from "../../apps/frontend/src/pages/Friends/FriendsPage"
import { SessionContext, socketContextDefaultValue } from "../../apps/frontend/src/server/socketContext/context"
import EmailVerificationPage from "../../apps/frontend/src/pages/Auth/EmailVerificationPage"
import { ProfileSessionRevokeModal } from "../../apps/frontend/src/pages/Profile/ProfileSessionRevokeModal"
import { AuthView } from "../../apps/frontend/src/pages/Auth/AuthView"
import WelcomePage from "../../apps/frontend/src/pages/Auth/WelcomePage"
import { AppShell } from "../../apps/frontend/src/ui/layout/AppShell"
import { ConversationList } from "../../apps/frontend/src/ui/layout/ConversationList"
import { ChatMessageList } from "../../apps/frontend/src/features/chat/components/ChatMessageList"
import { ChatComposer } from "../../apps/frontend/src/features/chat/components/ChatComposer"
import { Modal } from "../../apps/frontend/src/ui/overlays/Modal"
import type { DisplayMessage } from "../../apps/frontend/src/features/chat/types"
import "../../apps/frontend/src/index.css"
const surface = new URLSearchParams(location.search).get("surface") || "auth"
const users = Array.from({ length: 50 }, (_, index) => ({ id: index + 2, name: `Друг ${index + 1}`, is_room: false }))
const messages = Array.from({ length: 80 }, (_, index) => ({
    id: index + 1,
    text: `Сообщение ${index + 1}. Проверка прокрутки истории.`,
    data: Date.now() - (80 - index) * 60000,
    me: index % 2 === 0,
    from: index % 2 === 0 ? "alex" : "mira",
    read: true,
    reactions: [],
    editedAt: null
})) as DisplayMessage[]
const friendRows = users.map((user) => ({
    id: user.id,
    user_id: 1,
    friend_id: user.id,
    other_user_id: user.id,
    friend_username: user.name,
    status: "accepted",
    direction: "outgoing",
    is_room: false
}))
const socket = {
    connected: true,
    on() {
        return this
    },
    off() {
        return this
    },
    emit(event: string, ...args: unknown[]) {
        const callback = args.findLast((value) => typeof value === "function") as ((value: unknown) => void) | undefined
        setTimeout(
            () => callback?.(event === "friend:list" ? friendRows : event === "profile:friendsAvatars" ? {} : []),
            0
        )
        return this
    }
} as unknown as Socket
function Fixture() {
    const input = useRef<HTMLTextAreaElement>(null)
    const [text, setText] = useState(Array.from({ length: 20 }, (_, index) => `Строка ${index + 1}`).join("\n"))
    const [modal, setModal] = useState(surface === "modal" || surface === "settings")
    if (surface === "otp-email") return <EmailVerificationPage />
    if (surface === "otp-revoke")
        return (
            <ProfileSessionRevokeModal
                open
                target="others"
                token="isolated-qa-token"
                onClose={() => {}}
                onConfirmed={async () => {}}
            />
        )
    if (surface === "auth" || surface === "otp-recovery")
        return (
            <AuthView
                error=""
                loading={false}
                onEmailChange={() => {}}
                onPasswordChange={() => {}}
                onLogin={() => {}}
                onGoRegister={() => {}}
            />
        )
    if (surface === "welcome") return <WelcomePage />
    if (surface === "settings")
        return (
            <AppShell showConversationList={false} onOpenSettings={() => setModal(true)} onLogout={() => {}}>
                {modal && <SettingsModal onClose={() => setModal(false)} />}
            </AppShell>
        )
    if (surface === "friends")
        return (
            <AppShell showConversationList={false} onOpenSettings={() => {}} onLogout={() => {}}>
                <FriendsPage />
            </AppShell>
        )
    return (
        <AppShell
            showConversationList
            conversationOpen
            conversationList={<ConversationList users={users} selected={0} setUser={() => {}} setSelected={() => {}} />}
            onOpenSettings={() => setModal(true)}
            onLogout={() => {}}
        >
            <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
                <header style={{ padding: 12 }}>
                    Настоящие история и поле сообщения{" "}
                    <button onClick={() => setModal(true)}>Открыть длинный диалог QA</button>
                </header>
                <ChatMessageList
                    messages={messages}
                    is_room={false}
                    loading={false}
                    myName="alex"
                    onMessageContextMenu={() => {}}
                    onToggleReaction={() => {}}
                />
                <ChatComposer inputRef={input} value={text} maxLen={10000} onChange={setText} onSend={() => {}} />
            </div>
            {modal && (
                <Modal title="Длинный диалог QA" onClose={() => setModal(false)}>
                    {Array.from({ length: 60 }, (_, index) => (
                        <p key={index} style={{ padding: 12 }}>
                            Строка диалога {index + 1}
                        </p>
                    ))}
                </Modal>
            )}
        </AppShell>
    )
}
createRoot(document.getElementById("root")!).render(
    <MemoryRouter>
        <SessionContext.Provider value={{ ...socketContextDefaultValue, socket, myUserId: 1, myName: "alex" }}>
            <Fixture />
        </SessionContext.Provider>
    </MemoryRouter>
)
