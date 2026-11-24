import { useState, type KeyboardEvent } from "react"
import { FiArrowRight } from "react-icons/fi"
import styles from "./InviteField.module.css"

type InviteFieldProps = {
    onSubmit: (value: string) => void
    placeholder?: string
    maxLength?: number
    disabled?: boolean
}

export function InviteField({
    onSubmit,
    placeholder = "Никнейм друга",
    maxLength = 30,
    disabled = false
}: InviteFieldProps) {
    const [value, setValue] = useState("")

    const submit = () => {
        const trimmed = value.trim()
        if (!trimmed || disabled) return
        onSubmit(trimmed)
        setValue("")
    }

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault()
            submit()
        }
    }

    return (
        <div className={styles.wrap}>
            <input
                type="text"
                className={styles.input}
                value={value}
                onChange={(e) => setValue(e.target.value.slice(0, maxLength))}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                maxLength={maxLength}
                disabled={disabled}
                aria-label="Никнейм для заявки в друзья"
                autoComplete="off"
            />
            <button
                type="button"
                className={styles.sendBtn}
                onClick={submit}
                disabled={disabled || !value.trim()}
                aria-label="Отправить заявку"
            >
                <FiArrowRight size={18} />
            </button>
        </div>
    )
}
