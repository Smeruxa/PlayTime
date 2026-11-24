import type { ReactNode } from "react"
import { IconRail } from "./IconRail"
import styles from "./AppShell.module.css"
import { FiArrowLeft } from "react-icons/fi"

type AppShellProps = {
    showConversationList: boolean
    conversationList?: ReactNode
    onOpenSettings: () => void
    onLogout: () => void
    callPanel?: ReactNode
    children: ReactNode
    conversationOpen?: boolean
    onBackToConversations?: () => void
}

export function AppShell({
    showConversationList,
    conversationList,
    onOpenSettings,
    onLogout,
    callPanel,
    children,
    conversationOpen = false,
    onBackToConversations
}: AppShellProps) {
    return (
        <div
            className={`${styles.shell} ${showConversationList ? styles.hasConversations : ""} ${conversationOpen ? styles.conversationOpen : ""}`}
        >
            <IconRail onOpenSettings={onOpenSettings} onLogout={onLogout} />
            <div className={styles.workspace}>
                {showConversationList && <div className={styles.conversations}>{conversationList}</div>}
                <div className={styles.main}>
                    {showConversationList && conversationOpen && onBackToConversations && (
                        <button className={styles.mobileBack} onClick={onBackToConversations}>
                            <FiArrowLeft size={16} /> Все диалоги
                        </button>
                    )}
                    {callPanel ? <div className={styles.callPanel}>{callPanel}</div> : null}
                    <div className={styles.outlet}>{children}</div>
                </div>
            </div>
        </div>
    )
}
