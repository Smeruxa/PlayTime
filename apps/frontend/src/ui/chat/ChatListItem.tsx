import { motion } from "framer-motion"
import type { LastPreview } from "../../server/socket/types"
import { Avatar } from "../primitives/Avatar"
import { Badge } from "../primitives/Badge"
import styles from "./ChatListItem.module.css"

type ChatListItemProps = {
    archived?: boolean
    name: string
    isRoom: boolean
    selected: boolean
    online?: boolean
    lastPreview?: LastPreview
    avatarUrl?: string | null
    avatarEffect?: string
    unreadCount?: number
    onClick: () => void
}

export function ChatListItem({
    name,
    archived,
    isRoom,
    selected,
    online,
    lastPreview,
    avatarUrl,
    avatarEffect = "none",
    unreadCount = 0,
    onClick
}: ChatListItemProps) {
    return (
        <div
            className={styles.row}
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onClick()
                }
            }}
        >
            {selected ? (
                <motion.div
                    className={styles.selectedBg}
                    layoutId="conversationActive"
                    transition={{ type: "spring", stiffness: 400, damping: 34 }}
                />
            ) : null}
            <Avatar name={name} imageUrl={avatarUrl} effect={avatarEffect} isRoom={isRoom} size="sm" />
            <div className={styles.body}>
                <div className={styles.top}>
                    <span className={styles.name}>{name}</span>
                    {unreadCount > 0 ? <Badge count={unreadCount} /> : null}
                    {!isRoom ? (
                        <span className={styles.statusSlot} aria-hidden>
                            <span className={online ? styles.dotOnline : styles.dotOffline} />
                        </span>
                    ) : null}
                </div>
                {archived ? (
                    <span className={styles.preview}>Гость вышел · история сохранена</span>
                ) : lastPreview ? (
                    <span className={styles.preview}>
                        <span className={styles.previewFrom}>{lastPreview.from}: </span>
                        <span className={styles.previewText}>{lastPreview.content}</span>
                    </span>
                ) : null}
            </div>
        </div>
    )
}
