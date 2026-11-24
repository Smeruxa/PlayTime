import type { ButtonHTMLAttributes, ReactNode } from "react"
import styles from "./Button.module.css"

type Variant = "primary" | "secondary" | "ghost"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant
    children: ReactNode
}

export function Button({ variant = "primary", className, children, ...rest }: ButtonProps) {
    const cls = [styles.btn, styles[variant], className].filter(Boolean).join(" ")
    return (
        <button type="button" className={cls} {...rest}>
            {children}
        </button>
    )
}
