import { useState, useRef } from "react"
import styles from "./User.module.css"

type UserProps = {
    avatarUrl?: string
    name: string
    message?: string
    onClick?: () => void
}

export default function User({ avatarUrl = "./assets/smile.jpg", name, message="", onClick }: UserProps) {
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 })
    const [hovered, setHovered] = useState(false)
    const [active, setActive] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }

    return (
        <div
            ref={containerRef}
            className={styles.body}
            onClick={onClick}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => { setHovered(false); setActive(false) }}
            onMouseDown={() => setActive(true)}
            onMouseUp={() => setActive(false)}
        >
            {hovered && (
                <div
                    className={styles.cursorBall}
                    style={{
                        left: cursorPos.x,
                        top: cursorPos.y,
                        background: active ? "var(--second-text)" : "rgba(255, 255, 255, 0.05)"
                    }}
                />
            )}
            <div className={styles.content}>
                <img className={styles.img} src={avatarUrl} />
                <div className={styles.textWrapper}>
                    <span className={styles.name}>{name}</span>
                    <span className={styles.lastMessage}>{(message.length > 0) ? message : "Тут будет ваше первое сообщение"}</span>
                </div>
            </div>
        </div>
    )
}