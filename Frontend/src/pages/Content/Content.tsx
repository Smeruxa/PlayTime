import { useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { UserProps } from "../../types"
import { useSocket } from "../../server/SocketContext"
import { FriendItem } from "../Friends/Friends"
import Users from "../../components/Users/Users"
import styles from "./Content.module.css"
import Chat from "../../components/Chat/Chat"
import Profile from "../../components/Profile/Profile"
import ContentButtons from "../../components/ContentButton/ContentButtons"

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
                    name: v.friend_username
                }))
            )
        })

        const friendDeletes = (data: { from: string }) => {
            setUsers(prev => prev.filter(u => u.name !== data.from))
        }

        /*const updateLastMessageUser = (msg: { sender_username: string, receiver_username: string }) => {
            setUsers(prev => {
                const name = msg.sender_username === myName ? msg.receiver_username : msg.sender_username
                const existing = prev.find(u => u.name === name)
                if (!existing) return prev
                return [existing, ...prev.filter(u => u.name !== name)]
            })
        }*/

        socket.on("friend:remove", friendDeletes)
        //socket.on("message:receive", updateLastMessageUser)
        //socket.on("message:send:success", updateLastMessageUser)

        return () => {
            socket.off("friend:remove", friendDeletes)
            //socket.off("message:receive", updateLastMessageUser)
            //socket.off("message:send:success", updateLastMessageUser)
        }
    }, [socket, myName])

    return ( 
        <div className={styles.body}>
            <div className={styles.mainWrapper}>
                <div className={styles.nav}>
                    <ContentButtons />
                    <span className={styles.dialogsSpan}>Диалоги:</span>
                    <div className={styles.usersWrapper}>
                        <Users setUser={setUser} users={users}/>
                    </div>
                    <Profile username={myName} onDonate={() => navigate("/donate")} onOut={logout} />
                </div>
                <div className={styles.divider}></div>
                <div className={styles.content}>
                    {
                        users[currentUser] ?
                            <Chat name={users[currentUser].name} />
                        :
                            <Chat name="Выберите пользователя" />
                    }
                </div>
            </div>
        </div>
    )
}