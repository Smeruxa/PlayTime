import { useState } from "react"
import styles from "./Users.module.css"
import User from "../User/User"
import { UserProps } from "../../types"

interface UsersProps {
    setUser: (index: number) => void
    users: UserProps[]
}

export default function Users({ setUser, users }: UsersProps) {
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 })
    const [visible, setVisible] = useState(false)
    const [active, setActive] = useState(false)
    const [selected, setSelected] = useState<number | null>(null)

    return (
        <div
            className={styles.users}
            onMouseEnter={() => setVisible(true)}
            onMouseLeave={() => setVisible(false)}
            onMouseMove={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
            }}
            onMouseDown={() => setActive(true)}
            onMouseUp={() => setActive(false)}
        >
            <div
                className={styles.cursorBall}
                style={{
                    left: cursorPos.x,
                    top: cursorPos.y,
                    opacity: visible ? 1 : 0,
                    background: active ? "var(--second-text)" : "rgba(255,255,255,0.05)"
                }}
            />
            {users.length > 0 ? (
                users.map((user, index) => (
                    <div
                        key={index}
                        className={`${styles.userWrapper} ${selected === index ? styles.selectedUser : ""}`}
                        onClick={() => {
                            setSelected(index)
                            setUser(index)
                        }}
                    >
                        <User name={user.name} />
                    </div>
                ))
            ) : (
                <span>Нет друзей :(</span>
            )}
        </div>
    )
}