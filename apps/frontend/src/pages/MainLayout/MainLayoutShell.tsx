import { useLocation, useNavigate, Outlet } from "react-router-dom"
import { AnimatePresence } from "framer-motion"
import type { UserProps } from "../../types"
import type { FriendsAvatarsMap } from "../../types/friendAvatar"
import PageTransition from "../../routes/PageTransition"
import Talk from "../Talk/Remake/Talk"
import SettingsModal from "../../components/SettingsModal/SettingsModal"
import { useState, type Dispatch, type SetStateAction } from "react"
import type { CallProps } from "../../types"
import type { MainLayoutContext } from "./mainLayoutTypes"
import { AppShell } from "../../ui/layout/AppShell"
import { ConversationList } from "../../ui/layout/ConversationList"
import styles from "./MainLayout.module.css"
import { useAccountStatus } from "../../auth/AccountStatus"
import { Button, Modal } from "../../ui"

export type MainLayoutShellProps = {
    settingsOpen: boolean
    users: UserProps[]
    selected: number
    avatarByUsername: FriendsAvatarsMap
    listsLoading: boolean
    activeCall: CallProps | null
    context: MainLayoutContext
    onCloseSettings: () => void
    onOpenSettings: () => void
    onLogout: () => void
    setUser: (index: number) => void
    setSelected: (index: number) => void
    setActiveCall: Dispatch<SetStateAction<CallProps | null>>
}

export function MainLayoutShell({
    settingsOpen,
    users,
    selected,
    avatarByUsername,
    listsLoading,
    activeCall,
    context,
    onCloseSettings,
    onOpenSettings,
    onLogout,
    setUser,
    setSelected,
    setActiveCall
}: MainLayoutShellProps) {
    const location = useLocation()
    const navigate = useNavigate()
    const { account } = useAccountStatus()
    const [confirmLogout, setConfirmLogout] = useState(false)
    const showConversationList = location.pathname === "/content"

    return (
        <div className={styles.body}>
            {settingsOpen ? <SettingsModal onClose={onCloseSettings} /> : null}
            {confirmLogout && (
                <Modal
                    title="Выйти из аккаунта?"
                    onClose={() => setConfirmLogout(false)}
                    footer={
                        <div className={styles.logoutActions}>
                            <Button variant="secondary" onClick={onLogout}>
                                Выйти без регистрации
                            </Button>
                            <Button
                                onClick={() => {
                                    setConfirmLogout(false)
                                    navigate("/complete-account")
                                }}
                            >
                                Сохранить аккаунт
                            </Button>
                        </div>
                    }
                >
                    <p style={{ fontSize: 14, lineHeight: 1.7 }}>
                        {account?.registrationPending
                            ? "Регистрация ещё не завершена. Подтвердите почту кодом из письма, чтобы сохранить доступ к аккаунту."
                            : "Вы вошли по нику. Без почты и пароля войти в этот аккаунт снова не получится. Зарегистрируйте его, чтобы сохранить доступ. После выхода из последней сессии ник станет доступен другим людям."}
                    </p>
                </Modal>
            )}
            <AppShell
                showConversationList={showConversationList}
                conversationOpen={context.currentUser >= 0}
                onBackToConversations={() => {
                    setUser(-1)
                    setSelected(-1)
                    navigate("/content", { replace: true, state: null })
                }}
                conversationList={
                    <ConversationList
                        users={users}
                        selected={selected}
                        avatarByUsername={avatarByUsername}
                        listsLoading={listsLoading}
                        setUser={setUser}
                        setSelected={setSelected}
                    />
                }
                onOpenSettings={onOpenSettings}
                onLogout={() => (account?.isGuest ? setConfirmLogout(true) : onLogout())}
                callPanel={
                    activeCall ? (
                        <Talk
                            call={activeCall}
                            setShow={() => setActiveCall(null)}
                            setActiveCall={setActiveCall}
                            avatarByUsername={avatarByUsername}
                        />
                    ) : undefined
                }
            >
                <AnimatePresence mode="wait">
                    <PageTransition key={location.pathname}>
                        <Outlet context={context} />
                    </PageTransition>
                </AnimatePresence>
            </AppShell>
        </div>
    )
}
