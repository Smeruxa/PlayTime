import styles from "./User.module.css"

type UserProps = {
    avatarUrl?: string
    name: string
    onClick?: () => void
}

export default function User({ avatarUrl = "./assets/smile.jpg", name, onClick }: UserProps) {
    return (
        <div className={styles.body} onClick={onClick}>
            <div className={styles.content}>
                <img className={styles.img} src={avatarUrl} />
                <span className={styles.name}>{name}</span>
            </div>
        </div>
    )
}
