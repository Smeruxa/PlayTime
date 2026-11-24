import type { InputHTMLAttributes, ReactNode } from "react"
import styles from "./Checkbox.module.css"

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> & {
    children: ReactNode
    onCheckedChange: (checked: boolean) => void
}

export function Checkbox({ children, onCheckedChange, className = "", ...props }: Props) {
    return (
        <label className={`${styles.label} ${className}`}>
            <input
                {...props}
                className={styles.input}
                type="checkbox"
                onChange={(e) => onCheckedChange(e.target.checked)}
            />
            <span className={styles.box} aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none">
                    <path
                        d="m3.5 8 3 3 6-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </span>
            <span>{children}</span>
        </label>
    )
}
