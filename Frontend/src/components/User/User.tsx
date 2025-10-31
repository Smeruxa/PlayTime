import styles from "./User.module.css"

type UserProps = {
    name: string
    id: number
    is_room: boolean
    onClick?: () => void
}

export default function User({ name, id, is_room, onClick }: UserProps) {
    const initial = name.trim().charAt(0).toUpperCase()
    return (
        <div className={styles.body} onClick={onClick}>
            <div className={styles.content}>
                <div className={is_room ? styles.roomAvatar : styles.avatar}>{is_room ? null : initial}</div>
                <span className={styles.name}>{name}</span>
            </div>
        </div>
    )
}