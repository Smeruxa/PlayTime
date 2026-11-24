import type { InputHTMLAttributes } from "react"
import styles from "./Input.module.css"

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
    label?: string
}

export function Input({ label, id, className, ...rest }: InputProps) {
    const inputId = id ?? (label ? `input-${label.replace(/\s+/g, "-")}` : undefined)
    return (
        <label className={styles.field} htmlFor={inputId}>
            {label ? <span className={styles.label}>{label}</span> : null}
            <input id={inputId} className={[styles.input, className].filter(Boolean).join(" ")} {...rest} />
        </label>
    )
}
