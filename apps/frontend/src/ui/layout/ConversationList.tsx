import { useMemo, useState } from "react"
import type { UserProps } from "../../types"
import type { FriendsAvatarsMap } from "../../types/friendAvatar"
import { useChatPreviews, useOnlineUsers } from "../../server/socketContext"
import { SearchField } from "../primitives/SearchField"
import { ScrollArea } from "../primitives/ScrollArea"
import { ChatListItem } from "../chat/ChatListItem"
import styles from "./ConversationList.module.css"
import { useNavigate } from "react-router-dom"

type ConversationListProps = {
    users: UserProps[]
    selected: number
    avatarByUsername?: FriendsAvatarsMap
    listsLoading?: boolean
    setUser: (index: number) => void
    setSelected: (index: number) => void
}

function matchesQuery(name: string, preview: string | undefined, q: string): boolean {
    const hay = `${name} ${preview ?? ""}`.toLowerCase()
    return hay.includes(q)
}

function ListSkeleton() {
    const row = (key: string) => (
        <div key={key} className={styles.skeletonRow}>
            <div className={styles.skeletonAvatar} />
            <div style={{ flex: 1 }}>
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
        </div>
    )
}

export function ConversationList({
    users,
    selected,
    avatarByUsername,
    listsLoading = false,
    setUser,
    setSelected
}: ConversationListProps) {
    const navigate = useNavigate()
    const [query, setQuery] = useState("")
    const onlineUsernames = useOnlineUsers()
    const { lastPreviews, roomUnreadById, dmUnreadByUsername } = useChatPreviews()
    const q = query.trim().toLowerCase()

    const { rooms, friends } = useMemo(() => {
        const allRooms = users.filter((u) => u.is_room)
        const allFriends = users.filter((u) => !u.is_room)
        if (!q) return { rooms: allRooms, friends: allFriends }
        const roomsFiltered = allRooms.filter((u) => {
            const prev = lastPreviews[`room-${u.id}`]
            const text = prev ? `${prev.from} ${prev.content}` : ""
            return matchesQuery(u.name, text, q)
        })
        const friendsFiltered = allFriends.filter((u) => {
            const prev = lastPreviews[`dm-${u.id}`]
            const text = prev ? `${prev.from} ${prev.content}` : ""
            return matchesQuery(u.name, text, q)
        })
        return { rooms: roomsFiltered, friends: friendsFiltered }
    }, [users, q, lastPreviews])

    const select = (index: number) => {
        setSelected(index)
        setUser(index)
    }

    return (
        <aside className={styles.column} aria-label="Список чатов">
            <div className={styles.searchWrap}>
                <SearchField
                    value={query}
                    onChange={setQuery}
                    placeholder="Поиск в диалогах"
                    aria-label="Поиск в диалогах"
                />
            </div>
            <ScrollArea className={styles.listScroll}>
                {listsLoading ? (
                    <ListSkeleton />
                ) : (
                    <>
                        {rooms.length > 0 && (
                            <>
                                <span className={styles.sectionTitle}>Комнаты</span>
                                {rooms.map((user) => {
                                    const index = users.findIndex((u) => u.id === user.id && u.is_room === true)
                                    if (index === -1) return null
                                    return (
                                        <ChatListItem
                                            key={`room-${user.id}`}
                                            name={user.name}
                                            archived={user.archived}
                                            isRoom
                                            selected={selected === index}
                                            lastPreview={lastPreviews[`room-${user.id}`]}
                                            unreadCount={roomUnreadById[user.id] ?? 0}
                                            onClick={() => select(index)}
                                        />
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
                                        <ChatListItem
                                            key={`friend-${user.id}`}
                                            name={user.name}
                                            archived={user.archived}
                                            isRoom={false}
                                            selected={selected === index}
                                            online={!user.archived && onlineUsernames.has(user.id)}
                                            lastPreview={lastPreviews[`dm-${user.id}`]}
                                            avatarUrl={meta?.avatar}
                                            avatarEffect={meta?.profileAvatarEffect ?? "none"}
                                            unreadCount={dmUnreadByUsername[String(user.id)] ?? 0}
                                            onClick={() => select(index)}
                                        />
                                    )
                                })}
                            </>
                        )}
                        {users.length === 0 && (
                            <div className={styles.empty}>
                                <p>Здесь появятся ваши разговоры.</p>
                                <p>Найдите друзей по никнейму и начните общение.</p>
                                <button className={styles.emptyAction} onClick={() => navigate("/friends")}>
                                    Добавить друзей →
                                </button>
                            </div>
                        )}
                        {users.length > 0 && rooms.length === 0 && friends.length === 0 && q && (
                            <span className={styles.empty}>Ничего не найдено</span>
                        )}
                    </>
                )}
            </ScrollArea>
        </aside>
    )
}
