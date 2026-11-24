import { useState, useEffect } from "react"
import { useSessionSocket } from "../../server/socketContext"
import styles from "./AddMembersModal.module.css"

type Member = { id: number; username: string }
type FriendItem = { friend_id: number | null; friend_username: string; other_user_id?: number }

type Props = {
    roomId: number
    onClose: () => void
    onAdded?: () => void
}

export default function AddMembersModal({ roomId, onClose, onAdded }: Props) {
    const { socket } = useSessionSocket()
    const [members, setMembers] = useState<Member[]>([])
    const [friends, setFriends] = useState<FriendItem[]>([])
    const [loading, setLoading] = useState(true)
    const [adding, setAdding] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!socket || !roomId) return
        setLoading(true)
        let done = 0
        const check = () => {
            done++
            if (done === 2) setLoading(false)
        }
        socket.emit("room:get", { roomId }, (res: { err?: string; members?: Member[] }) => {
            if (res?.members) setMembers(res.members)
            check()
        })
        socket.emit(
            "friend:list",
            null,
            (
                list: {
                    status: string
                    friend_id: number | null
                    friend_username: string
                    is_room?: boolean
                    other_user_id?: number
                }[]
            ) => {
                const accepted = (list || []).filter(
                    (f) => f.status === "accepted" && !f.is_room && (f.other_user_id != null || f.friend_id != null)
                )
                setFriends(
                    accepted.map((f) => ({
                        friend_id: f.other_user_id ?? f.friend_id ?? 0,
                        friend_username: f.friend_username,
                        other_user_id: f.other_user_id
                    }))
                )
                check()
            }
        )
    }, [socket, roomId])

    const memberIds = new Set(members.map((m) => Number(m.id)))
    const canAdd = friends.filter((f) => !memberIds.has(Number(f.other_user_id ?? f.friend_id)))

    const addMember = (username: string) => {
        setAdding(username)
        setError(null)
        socket?.emit("room:addMember", { roomId, username }, (r: { success?: boolean; err?: string }) => {
            setAdding(null)
            if (r?.success) {
                socket?.emit("room:get", { roomId }, (res: { members?: Member[] }) => {
                    if (res?.members) setMembers(res.members)
                })
                onAdded?.()
            } else {
                setError(r?.err || "Ошибка")
            }
        })
    }

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <h3 className={styles.title}>Добавить в комнату</h3>
                {error && <p className={styles.error}>{error}</p>}
                {loading ? (
                    <p className={styles.muted}>Загрузка...</p>
                ) : canAdd.length === 0 ? (
                    <p className={styles.muted}>Все друзья уже в комнате или нет друзей</p>
                ) : (
                    <ul className={styles.list}>
                        {canAdd.map((f) => (
                            <li key={f.friend_id} className={styles.item}>
                                <span>{f.friend_username}</span>
                                <button
                                    type="button"
                                    className={styles.addBtn}
                                    disabled={adding !== null}
                                    onClick={() => addMember(f.friend_username)}
                                >
                                    {adding === f.friend_username ? "..." : "Добавить"}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <button type="button" className={styles.btnClose} onClick={onClose}>
                    Закрыть
                </button>
            </div>
        </div>
    )
}
