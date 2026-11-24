import styles from "./Users.module.css"
import User from "../User/User"
import { UserProps } from "../../types"
import { useChatPreviews, useOnlineUsers } from "../../server/socketContext"
import type { FriendsAvatarsMap } from "../../types/friendAvatar"

interface UsersProps {
    setUser: (index: number) => void
    selected: number
    setSelected: (index: number) => void
    users: UserProps[]
    avatarByUsername?: FriendsAvatarsMap
    listsLoading?: boolean
}

function UsersListSkeleton() {
    const row = (key: string) => (
        <div key={key} className={styles.skeletonUserRow}>
            <div className={styles.skeletonAvatar} />
            <div className={styles.skeletonTextCol}>
                <div className={styles.skeletonLineWide} />
                <div className={styles.skeletonLineNarrow} />
            </div>
        </div>
    )
    return (
        <div className={styles.skeletonList} aria-busy="true" aria-label="Загрузка списка">
            <span className={styles.sectionTitle}>Комнаты</span>
            {row("sr1")}
            {row("sr2")}
            <span className={styles.sectionTitle}>Диалоги</span>
            {row("sf1")}
            {row("sf2")}
            {row("sf3")}
        </div>
    )
}

export default function Users({
    setUser,
    users,
    selected,
    setSelected,
    avatarByUsername,
    listsLoading = false
}: UsersProps) {
    const onlineUsernames = useOnlineUsers()
    const { lastPreviews, roomUnreadById, dmUnreadByUsername } = useChatPreviews()
    const rooms = users.filter((u) => u.is_room)
    const friends = users.filter((u) => !u.is_room)

    if (listsLoading) {
        return (
            <div className={styles.users}>
                <UsersListSkeleton />
            </div>
        )
    }

    return (
        <div className={styles.users}>
            {rooms.length > 0 && (
                <>
                    <span className={styles.sectionTitle}>Комнаты</span>
                    {rooms.map((user) => {
                        const index = users.findIndex((u) => u.id === user.id && u.is_room === true)
                        if (index === -1) return null
                        return (
                            <div
                                key={`room-${user.id}`}
                                className={`${styles.userWrapper} ${selected === index ? styles.selectedUser : ""}`}
                                onClick={() => {
                                    setSelected(index)
                                    setUser(index)
                                }}
                            >
                                <User
                                    name={user.name}
                                    archived={user.archived}
                                    is_room={true}
                                    id={user.id}
                                    lastPreview={lastPreviews[`room-${user.id}`] ?? undefined}
                                    unreadCount={roomUnreadById[user.id] ?? 0}
                                />
                            </div>
                        )
                    })}
                </>
            )}
            {friends.length > 0 && (
                <>
                    <span className={styles.sectionTitle}>Диалоги</span>
                    {friends.map((user) => {
                        const index = users.findIndex((u) => u.id === user.id && u.is_room === false)
                        if (index === -1) return null
                        const meta = avatarByUsername?.[String(user.id)]
                        return (
                            <div
                                key={`friend-${user.id}`}
                                className={`${styles.userWrapper} ${selected === index ? styles.selectedUser : ""}`}
                                onClick={() => {
                                    setSelected(index)
                                    setUser(index)
                                }}
                            >
                                <User
                                    name={user.name}
                                    archived={user.archived}
                                    is_room={false}
                                    id={user.id}
                                    online={!user.archived && onlineUsernames.has(user.id)}
                                    lastPreview={lastPreviews[`dm-${user.id}`] ?? undefined}
                                    avatarUrl={meta?.avatar ?? undefined}
                                    avatarEffect={meta?.profileAvatarEffect ?? "none"}
                                    unreadCount={dmUnreadByUsername[String(user.id)] ?? 0}
                                />
                            </div>
                        )
                    })}
                </>
            )}
            {users.length === 0 && <span className={styles.empty}>Нет комнат и друзей</span>}
        </div>
    )
}
