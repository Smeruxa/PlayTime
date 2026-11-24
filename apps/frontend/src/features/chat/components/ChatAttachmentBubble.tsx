import { useEffect, useState } from "react"
import { API_BASE } from "../../../config"
import styles from "../../../ui/chat/MessageBubble.module.css"
import { isPreviewImage, mediaBlobForPlayback, type MediaDescriptor } from "../mediaEncryption"

type Props = {
    attachmentKey: string
    mime: string
    filename: string
    sizeBytes: number
    mine: boolean
    media?: MediaDescriptor
}

export function ChatAttachmentBubble({ attachmentKey, mime, filename, sizeBytes, mine, media }: Props) {
    const [url, setUrl] = useState<string | null>(null)
    const [failed, setFailed] = useState(false)
    const [isImage, setIsImage] = useState(false)

    useEffect(() => {
        let cancelled = false
        let objectUrl: string | null = null
        setFailed(false)
        setUrl(null)

        const run = async () => {
            const token = localStorage.getItem("token")
            if (!token) {
                setFailed(true)
                return
            }
            try {
                const res = await fetch(`${API_BASE}/attachments/${encodeURIComponent(attachmentKey)}`, {
                    headers: { Authorization: `Bearer ${token}` }
                })
                if (!res.ok) throw new Error("attachment fetch")
                const blob = await mediaBlobForPlayback(await res.blob(), mime, media)
                if (cancelled) return
                objectUrl = URL.createObjectURL(blob)
                setUrl(objectUrl)
                setIsImage(isPreviewImage(blob.type))
            } catch {
                if (!cancelled) setFailed(true)
            }
        }

        void run()
        return () => {
            cancelled = true
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [attachmentKey, mime, media])

    if (failed) {
        return <span className={styles.attachmentError}>Не удалось загрузить файл</span>
    }

    if (!url) {
        return <span className={styles.attachmentPending}>Загрузка файла…</span>
    }

    if (isImage) {
        return (
            <a
                href={url}
                download={filename}
                className={styles.attachmentImageLink}
                onClick={(e) => e.stopPropagation()}
            >
                <img src={url} alt={filename} className={styles.attachmentImage} />
            </a>
        )
    }

    const sizeKb = Math.max(1, Math.round(sizeBytes / 1024))
    return (
        <a
            href={url}
            download={filename}
            className={`${styles.attachmentFile} ${mine ? styles.attachmentFileMine : ""}`}
            onClick={(e) => e.stopPropagation()}
        >
            <span className={styles.attachmentFileName}>{filename}</span>
            <span className={styles.attachmentFileMeta}>
                {mime.split("/").pop()} · {sizeKb} КБ
            </span>
        </a>
    )
}
