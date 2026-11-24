import type { ButtonHTMLAttributes, ReactNode } from "react"
import styles from "./IconButton.module.css"

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean
    size?: "sm" | "md"
    children: ReactNode
}

export function IconButton({ active, size = "md", className, children, ...rest }: IconButtonProps) {
    const cls = [styles.iconBtn, size === "sm" ? styles.sm : "", active ? styles.active : "", className]
        .filter(Boolean)
        .join(" ")
    return (
        <button type="button" className={cls} {...rest}>
            {children}
        </button>
    )
}
