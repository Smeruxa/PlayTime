import { useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { UserProps, Message } from "../../types"
import { useSocket } from "../../server/SocketContext"
import { FriendItem } from "../Friends/Friends"
import Users from "../../components/Users/Users"
import styles from "./Content.module.css"
import Chat from "../../components/Chat/Chat"
import SubscribeButton from "../../components/SubscribeButton/SubscribeButton"
import BlueButton from "../../components/BlueButton/BlueButton"
import ProfileButton from "../../components/ProfileButton/ProfileButton"

export default function Content() {
    const navigate = useNavigate()

    const [users, setUsers] = useState<UserProps[]>([])
    const [currentUser, setUser] = useState(-1)
    const [myName, setMyName] = useState<string | null>("")

    const { socket, logout } = useSocket()

    useEffect(() => {
        if (!socket) return

        socket.emit("get:username", (username: string) => setMyName(username))
        socket.emit("friend:list", null, (list: FriendItem[]) => {
            const accepted = list.filter(f => f.status === "accepted")
            setUsers(
                accepted.map(v => ({
                    name: v.friend_username,
                    messages: [] as Message[]
                }))
            )
        })

        const friendDeletes = (data: { from: string }) => {
            setUsers(prev => prev.filter(u => u.name !== data.from))
        }

        socket.on("friend:remove", friendDeletes)

        return () => {
            socket.off("friend:remove", friendDeletes)
        }
    }, [socket])

    return ( 
        <div className={styles.body}>
            <div className={styles.mainWrapper}>
                <div className={styles.nav}>
                    <ProfileButton username={myName} />
                    <div className={styles.friendsWrapper}>
                        <BlueButton text="Друзья" className={styles.friends} onClick={() => navigate("/friends")} />
                    </div>
                    <div className={styles.usersWrapper}>
                        <Users setUser={setUser} users={users}/>
                    </div>
                    <div className={styles.downWrapper}>
                        <div className={styles.quitWrapper}>
                            <BlueButton text="Выйти из аккаунта" className={styles.quitButton} onClick={logout} />
                        </div>
                        <SubscribeButton className={styles.subscribeButton} onClick={() => navigate("/donate")} />
                    </div>
                </div>
                <div className={styles.divider}></div>
                <div className={styles.content}>
                    {
                        (currentUser === -1) ? (
                            <span className={styles.nothing}>Выберите пользователя и начните общение</span>
                        ) : (
                            <Chat name={users[currentUser].name} messages={users[currentUser].messages} />
                        )
                    }
                </div>
            </div>
        </div>
    )
}