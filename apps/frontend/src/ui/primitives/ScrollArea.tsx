import type { HTMLAttributes, ReactNode } from "react"
import styles from "./ScrollArea.module.css"

type ScrollAreaProps = HTMLAttributes<HTMLDivElement> & {
    children: ReactNode
}

export function ScrollArea({ className, children, ...rest }: ScrollAreaProps) {
    return (
        <div className={[styles.scroll, className].filter(Boolean).join(" ")} {...rest}>
            {children}
        </div>
    )
}
