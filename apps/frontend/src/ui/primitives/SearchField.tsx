import { FaSearch } from "react-icons/fa"
import styles from "./SearchField.module.css"

type SearchFieldProps = {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    "aria-label"?: string
}

export function SearchField({
    value,
    onChange,
    placeholder = "Поиск…",
    "aria-label": ariaLabel = "Поиск"
}: SearchFieldProps) {
    return (
        <div className={styles.wrap}>
            <FaSearch className={styles.icon} aria-hidden />
            <input
                type="search"
                className={styles.input}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                aria-label={ariaLabel}
            />
        </div>
    )
}
