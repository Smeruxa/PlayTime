import type { HTMLAttributes, ReactNode } from "react"
import styles from "./Panel.module.css"

type PanelProps = HTMLAttributes<HTMLDivElement> & {
    children: ReactNode
}

export function Panel({ className, children, ...rest }: PanelProps) {
    return (
        <div className={[styles.panel, className].filter(Boolean).join(" ")} {...rest}>
            {children}
        </div>
    )
}
