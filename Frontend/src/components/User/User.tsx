import styles from "./User.module.css"

type UserProps = {
    name: string
    onClick?: () => void
}

export default function User({ name, onClick }: UserProps) {
    const initial = name.trim().charAt(0).toUpperCase()
    return (
        <div className={styles.body} onClick={onClick}>
            <div className={styles.content}>
                <div className={styles.avatar}>{initial}</div>
                <span className={styles.name}>{name}</span>
            </div>
        </div>
    )
}