import { useLayoutEffect, useRef, useState } from "react"
import styles from "./MessageContextMenu.module.css"

type Props = {
    clientX: number
    clientY: number
    readers: string[]
    onClose: () => void
}

export function RoomReadersPopover({ clientX, clientY, readers, onClose }: Props) {
    const ref = useRef<HTMLDivElement>(null)
    const [[left, top], setPos] = useState(() => clamp(clientX, clientY, 220, 120))

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        setPos(clamp(clientX, clientY, el.offsetWidth, el.offsetHeight))
    }, [clientX, clientY, readers])

    return (
        <div ref={ref} className={styles.readersBox} style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.readersTitle}>Прочитали</div>
            {readers.length === 0 ? (
                <div className={styles.readersEmpty}>Пока никто</div>
            ) : (
                <ul className={styles.readersList}>
                    {readers.map((u) => (
                        <li key={u}>{u}</li>
                    ))}
                </ul>
            )}
            <button type="button" className={styles.itemMuted} onClick={onClose}>
                Закрыть
            </button>
        </div>
    )
}

function clamp(x: number, y: number, w: number, h: number): [number, number] {
    const pad = 6
    let left = x
    let top = y
    if (left + w + pad > window.innerWidth) left = window.innerWidth - w - pad
    if (top + h + pad > window.innerHeight) top = window.innerHeight - h - pad
    if (left < pad) left = pad
    if (top < pad) top = pad
    return [left, top]
}
