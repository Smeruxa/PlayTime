import type { ReactNode } from "react"
import styles from "./TextAccent.module.css"

export function TextAccent({ children }: { children: ReactNode }) {
    return <span className={styles.text}>{children}</span>
}
