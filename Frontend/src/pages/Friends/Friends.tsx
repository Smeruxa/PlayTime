import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useSocket } from "../../server/SocketContext"
import styles from "./Friends.module.css"
import NavButton, { Button } from "../../components/NavButton/NavButton"
import FindInputText from "../../components/FindInputText/FindInputText"
import PendingUsers from "../../components/PendingUser/PendingUsers"

export type FriendItem = {
    id: number
    user_id: number
    friend_id: number
    status: "pending" | "accepted" | "blocked"
    friend_username: string
}

export default function Friends() {
    const navigate = useNavigate();
    const buttons: Button[] = [
        { text: "Добавить друга", onClick: () => setButton(0) },
        { text: "Список друзей", onClick: () => setButton(1) },
        { text: "Вернуться", onClick: () => navigate("/content") }
    ]

    const [message, setMessage] = useState<string>("");
    const [messageType, setMessageType] = useState<number>(0);
    const [nameValue, setNameValue] = useState<string>("");
    const [currentButton, setButton] = useState<number>(0);
    const [friends, setFriends] = useState<FriendItem[]>([])
    const [incomingRequests, setIncomingRequests] = useState<FriendItem[]>([])
    const [outgoingRequests, setOutgoingRequests] = useState<string[]>([])

    const { socket } = useSocket()

    useEffect(() => {
        if (!socket) return

        const loadFriends = () => {
            socket.emit("friend:list", null, (list: FriendItem[]) => {
                const accepted = list.filter(f => f.status === "accepted")
                const incoming = list.filter(f => f.status === "pending" && (f as any).direction === "incoming")
                setFriends(accepted)
                setIncomingRequests(incoming)
            })
        }

        const loadOutgoingList = () => {
            socket.emit("friend:outgoingList", null, (list: string[]) => {
                setOutgoingRequests(list)
            })
        }

        socket.on("friend:outgoingList:error", () => {
            setOutgoingRequests([])
        })

        socket.on("friend:request", (data) => {
            setIncomingRequests(prev => [...prev, { ...data, status: "pending" }])
        })

        socket.on("friend:accept", (data) => {
            setFriends(prev => [...prev, { ...data, status: "accepted" }])
            setIncomingRequests(prev => prev.filter(r => r.friend_username !== data.from.username))
            setOutgoingRequests(prev => prev.filter(name => name !== data.from.username))
        })

        socket.on("friend:decline", (data) => {
            setIncomingRequests(prev => prev.filter(r => r.friend_username !== data.from.username))
            setOutgoingRequests(prev => prev.filter(name => name !== data.from.username))
        })

        socket.on("friend:block", data => {
            setFriends(prev => prev.filter(f => f.friend_username !== data.from.username))
            setIncomingRequests(prev => prev.filter(r => r.friend_username !== data.from.username))
            setOutgoingRequests(prev => prev.filter(name => name !== data.from.username))
        })

        socket.on("friend:request:success", (data) => {
            setMessageType(0)
            setMessage(data.msg)
            setOutgoingRequests(prev => [...prev, data.username])
            setNameValue("")
        })

        socket.on("friend:request:error", (data) => {
            setMessageType(1)
            setMessage(data.err)
            setNameValue("")
        })

        loadFriends()
        loadOutgoingList()

        return () => {
            socket.off("friend:outgoingList:error")
            socket.off("friend:request")
            socket.off("friend:request:error")
            socket.off("friend:request:success")
            socket.off("friend:accept")
            socket.off("friend:decline")
            socket.off("friend:block")
        }
    }, [socket])

    const sendRequest = () => {
        if (!socket || !nameValue) return
        socket.emit("friend:request", { friendUsername: nameValue })
    }

    const acceptRequest = (username: string) => {
        if (!socket) return
        socket.emit("friend:accept", { friendUsername: username })

        const request = incomingRequests.find(r => r.friend_username === username)
        if (request) {
            setFriends(prev => [...prev, { ...request, status: "accepted" }])
        }

        setIncomingRequests(prev => prev.filter(r => r.friend_username !== username))
        setOutgoingRequests(prev => prev.filter(name => name !== username))
    }

    const declineRequest = (username: string) => {
        if (!socket) return
        socket.emit("friend:decline", { friendUsername: username })
        setIncomingRequests(prev => prev.filter(r => r.friend_username !== username))
    }

    const declineOutgoingRequest = (username: string) => {
        if (!socket) return
        socket.emit("friend:decline", { friendUsername: username })
        setOutgoingRequests(prev => prev.filter(name => name !== username))
    }

    const blockRequest = (username: string) => {
        if (!socket) return 
        socket.emit("friend:block", { friendUsername: username })
        setIncomingRequests(prev => prev.filter(r => r.friend_username !== username))
    }

    const removeFriend = (username: string) => {
        if (!socket) return
        socket.emit("friend:remove", { friendUsername: username })
        setFriends(prev => prev.filter(f => f.friend_username !== username))
    }

    const contentMap: Record<number, React.ReactNode> = {
        0: (
            <div style={{ flex: "1" }}>
                <FindInputText onClick={sendRequest} onChange={setNameValue} />
                {message && 
                    <div 
                        className={styles.messageInput}
                        style={{color: messageType === 0 ? "#42F143" : "#F52F2F"}}>
                        {message}
                    </div>}
                <div className={styles.incomingBody}>
                    <span className={styles.incomingBodyText}>Входящие заявки</span>
                    <PendingUsers users={incomingRequests} accept={acceptRequest} decline={declineRequest} block={blockRequest} />
                </div>
            </div>
        ),
        1: (
            <div className={styles.friendsList}>
                <span className={styles.friendsSpan}>Друзья</span>
                {friends.length > 0 ? (
                    <ul className={styles.secondList}>
                        {friends.map(f => (
                            <li key={f.id} className={styles.secondItem}>
                                <div className={styles.secondLeft}>
                                    <div className={styles.secondAvatar}></div>
                                    <div className={styles.secondInfo}>
                                        <span className={styles.secondUsername}>{f.friend_username}</span>
                                        <span className={styles.secondSubtext}>{"Не в сети"}</span>
                                    </div>
                                </div>
                                <div className={styles.secondActions}>
                                    <button onClick={() => navigate("/content")} className={`${styles.secondButton} ${styles.secondBtnAnswer}`}>Написать</button>
                                    <button onClick={() => removeFriend(f.friend_username)} className={`${styles.secondButton} ${styles.secondBtnRemove}`}>Удалить</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <span className={styles.noRequest}>У вас пока нет друзей</span>
                )}
                <span className={styles.friendsSpan}>Исходящие запросы</span>
                {outgoingRequests.length > 0 ? (
                    <ul className={styles.secondList}>
                        {outgoingRequests.map((name, idx) => (
                            <li key={idx} className={styles.secondItem}>
                                <div className={styles.secondLeft}>
                                    <div className={styles.secondAvatar}></div>
                                    <div className={styles.secondInfo}>
                                        <span className={styles.secondUsername}>{name}</span>
                                        <span className={styles.secondSubtext}>Запрос отправлен</span>
                                    </div>
                                </div>
                                <div className={styles.secondActions}>
                                    <button onClick={() => declineOutgoingRequest(name)} className={`${styles.secondButton} ${styles.secondBtnRemove}`}>Отменить запрос</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <span className={styles.noRequest}>Исходящих запросов нет</span>
                )}
            </div>
        )
    }

    return (
        <div className={styles.body}>
            <div className={styles.bodyWrapper}>
                <NavButton buttons={buttons} />
                <div className={styles.content}>
                   {contentMap[currentButton]}
                </div>
            </div>
        </div>
    )
}