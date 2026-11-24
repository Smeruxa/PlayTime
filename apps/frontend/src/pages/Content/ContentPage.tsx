import { useNavigate, useOutletContext } from "react-router-dom"
import { FiMessageCircle } from "react-icons/fi"
import { Button } from "../../ui"
import Chat from "../../components/Chat/Chat"
import type { MainLayoutContext } from "../MainLayout"
import { useContentChatSync } from "./useContentChatSync"
import styles from "./Content.module.css"

export default function ContentPage() {
    const navigate = useNavigate()
    const { users, currentUser, updateRoomName } = useOutletContext<MainLayoutContext>()
    const user = users[currentUser]
    useContentChatSync(currentUser, user)

    return (
        <div className={styles.content}>
            {user ? (
                <Chat {...user} onRoomRename={updateRoomName} />
            ) : (
                <section className={styles.empty}>
                    <span className={styles.emptyIcon}>
                        <FiMessageCircle size={28} />
                    </span>
                    <h1>{users.length ? "Выберите разговор" : "Всё начинается с разговора"}</h1>
                    <p>
                        {users.length
                            ? "Откройте диалог или комнату слева, чтобы продолжить общение."
                            : "Добавьте друзей по никнейму или создайте комнату для своей компании."}
                    </p>
                    <div className={styles.emptyActions}>
                        <Button onClick={() => navigate("/friends")}>Добавить друзей</Button>
                        <Button variant="secondary" onClick={() => navigate("/createRoom")}>
                            Создать комнату
                        </Button>
                    </div>
                </section>
            )}
        </div>
    )
}
