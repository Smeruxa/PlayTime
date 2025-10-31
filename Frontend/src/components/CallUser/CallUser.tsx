import styles from "./CallUser.module.css"

interface CallProps {
    name: string;
}

export default function CallUser({ name }: CallProps) {
    return (
        <div className={styles.body}>
            <div className={styles.avatar}></div>
            <span>{name}</span>
        </div>
    )
}