import { useState, useEffect } from "react"
import { FaTimes, FaUserPlus } from "react-icons/fa"
import { useSessionSocket } from "../../server/socketContext"
import { RoomDeleteHold } from "../Users/RoomDeleteHold"
import { Modal } from "../../ui/overlays/Modal"
import { Button } from "../../ui/primitives/Button"
import { Input } from "../../ui/primitives/Input"
import { ScrollArea } from "../../ui/primitives/ScrollArea"
import styles from "./RoomSettingsModal.module.css"

type Member = { id: number; username: string; role?: "member" | "moderator" }

type RoomGetResponse = {
    err?: string
    members?: Member[]
    created_by?: number
    myId?: number
}

type Props = {
    roomId: number
    currentName: string
    onClose: () => void
    onRename: (newName: string) => void
    onOpenAddMembers: () => void
}

export default function RoomSettingsModal({ roomId, currentName, onClose, onRename, onOpenAddMembers }: Props) {
    const { socket } = useSessionSocket()
    const [name, setName] = useState(currentName)
    const [members, setMembers] = useState<Member[]>([])
    const [createdBy, setCreatedBy] = useState<number | null>(null)
    const [myId, setMyId] = useState<number | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [removingId, setRemovingId] = useState<number | null>(null)

    useEffect(() => {
        setName(currentName)
    }, [currentName])

    useEffect(() => {
        if (!socket || !roomId) return
        setLoading(true)
        socket.emit("room:get", { roomId }, (res: RoomGetResponse) => {
            setLoading(false)
            if (res?.members) setMembers(res.members)
            if (res?.created_by != null) setCreatedBy(res.created_by)
            if (res?.myId != null) setMyId(res.myId)
        })
    }, [socket, roomId])

    const handleRename = () => {
        const trimmed = name.trim()
        if (trimmed.length < 3 || trimmed.length > 15) {
            setError("От 3 до 15 символов")
            return
        }
        setError(null)
        socket?.emit(
            "room:rename",
            { roomId, name: trimmed },
            (r: { success?: boolean; name?: string; err?: string }) => {
                if (r?.success && r.name) {
                    onRename(r.name)
                    onClose()
                } else {
                    setError(r?.err || "Ошибка")
                }
            }
        )
    }

    const canRemove = createdBy != null && myId != null && createdBy === myId
    const canInvite = canRemove || members.find(member => member.id === myId)?.role === "moderator"
    const manageMember = async (member: Member, transfer: boolean) => {
        if (!socket || !canRemove) return
        if (transfer && !window.confirm(`Передать владение комнатой пользователю ${member.username}? Вы потеряете права владельца.`)) return
        setRemovingId(member.id); setError(null)
        try {
            const response = await socket.timeout(8000).emitWithAck(transfer ? "room:transferOwnership" : "room:setRole", { roomId, userId: member.id, role: member.role === "moderator" ? "member" : "moderator" })
            if (!response?.success) throw new Error(response?.err || "Не удалось изменить права")
            if (transfer) { setCreatedBy(member.id); onClose() }
            else setMembers(previous => previous.map(item => item.id === member.id ? { ...item, role: item.role === "moderator" ? "member" : "moderator" } : item))
        } catch (error) { setError(error instanceof Error ? error.message : "Сервер не ответил. Откройте настройки снова.") }
        finally { setRemovingId(null) }
    }
    const handleRemove = (userId: number) => {
        if (!socket || userId === myId) return
        setError(null)
        setRemovingId(userId)
        socket.emit("room:removeMember", { roomId, userId }, (r: { success?: boolean; err?: string }) => {
            setRemovingId(null)
            if (r?.success) setMembers((prev) => prev.filter((m) => m.id !== userId))
            else setError(r?.err || "Ошибка")
        })
    }

    return (
        <Modal title="Настройки комнаты" onClose={onClose} panelClassName={styles.panelWide}>
            <div className={styles.sections}>
                <section className={styles.section}>
                    <h3 className={styles.sectionTitle}>Название</h3>
                    <p className={styles.sectionHint}>От 3 до 15 символов — видно всем в списке комнат.</p>
                    <Input
                        label="Название комнаты"
                        disabled={!canRemove}
                        value={name}
                        maxLength={15}
                        placeholder="Например, Команда"
                        onChange={(e) => setName(e.target.value.slice(0, 15))}
                    />
                    {error ? (
                        <p className={styles.error} role="alert">
                            {error}
                        </p>
                    ) : null}
                    <Button variant="primary" className={styles.fullWidth} disabled={!canRemove} onClick={handleRename}>
                        Сохранить название
                    </Button>
                </section>

                <section className={styles.section}>
                    <div className={styles.sectionHead}>
                        <h3 className={styles.sectionTitle}>Участники</h3>
                        <span className={styles.countBadge}>{loading ? "…" : members.length}</span>
                    </div>
                    {loading ? (
                        <p className={styles.muted}>Загрузка списка…</p>
                    ) : members.length === 0 ? (
                        <p className={styles.muted}>Пока никого нет</p>
                    ) : (
                        <ScrollArea className={styles.memberScroll}>
                            <ul className={styles.memberList}>
                                {members.map((m) => (
                                    <li key={m.id} className={styles.memberRow}>
                                        <span className={styles.memberName}>
                                            {m.username}
                                            {m.id === createdBy ? " · Владелец" : m.role === "moderator" ? " · Модератор" : ""}
                                            {m.id === myId ? (
                                                <span className={styles.youTag}> (вы)</span>
                                            ) : null}
                                        </span>
                                        {canRemove && m.id !== myId && <details><summary>Права</summary><div className={styles.memberActions}>
                                            <Button variant="ghost" disabled={removingId !== null} onClick={() => void manageMember(m, false)}>{m.role === "moderator" ? "Снять модератора" : "Назначить модератором"}</Button>
                                            <Button variant="ghost" disabled={removingId !== null} onClick={() => void manageMember(m, true)}>Передать владение</Button>
                                        </div></details>}
                                        {canRemove && m.id !== myId ? (
                                            <button
                                                type="button"
                                                className={styles.removeBtn}
                                                title="Удалить из комнаты"
                                                aria-label={`Удалить ${m.username} из комнаты`}
                                                disabled={removingId !== null}
                                                onClick={() => handleRemove(m.id)}
                                            >
                                                <FaTimes aria-hidden />
                                            </button>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        </ScrollArea>
                    )}
                    {canInvite && <Button
                        variant="secondary"
                        className={styles.fullWidth}
                        onClick={() => {
                            onClose()
                            onOpenAddMembers()
                        }}
                    >
                        <FaUserPlus aria-hidden />
                        Добавить участников
                    </Button>}
                </section>

                {canRemove ? (
                    <section className={`${styles.section} ${styles.dangerSection}`}>
                        <h3 className={styles.sectionTitle}>Удаление комнаты</h3>
                        <p className={styles.dangerHint}>
                            Комната и переписка исчезнут для всех участников. Удерживайте кнопку 3 секунды.
                        </p>
                        <RoomDeleteHold roomId={roomId} onDeleted={onClose} />
                    </section>
                ) : null}
            </div>
        </Modal>
    )
}
