import styles from "./Badge.module.css"

type BadgeProps = {
    count: number
    max?: number
}

export function Badge({ count, max = 99 }: BadgeProps) {
    if (count <= 0) return null
    const label = count > max ? `${max}+` : String(count)
    return (
        <span className={styles.badge} aria-label={`Непрочитанных: ${count}`}>
            {label}
        </span>
    )
}
