import type { ReactNode } from "react"
import styles from "./PageCanvas.module.css"

type PageCanvasProps = {
    children: ReactNode
    className?: string
    innerClassName?: string
}

export function PageCanvas({ children, className, innerClassName }: PageCanvasProps) {
    return (
        <div className={[styles.canvas, className].filter(Boolean).join(" ")}>
            <div className={[styles.inner, innerClassName].filter(Boolean).join(" ")}>{children}</div>
        </div>
    )
}
