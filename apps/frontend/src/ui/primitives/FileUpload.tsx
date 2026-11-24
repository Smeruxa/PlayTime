import { useId, useRef, useState } from "react"
import { FiFileText, FiUpload, FiX } from "react-icons/fi"
import { Button } from "./Button"
import { IconButton } from "./IconButton"
import styles from "./FileUpload.module.css"

type FileUploadProps = {
    label: string
    hint: string
    accept: string
    file: File | null
    onChange: (file: File | null) => void
    disabled?: boolean
    error?: string
}

export function FileUpload({ label, hint, accept, file, onChange, disabled, error }: FileUploadProps) {
    const id = useId()
    const input = useRef<HTMLInputElement>(null)
    const dragDepth = useRef(0)
    const [dragging, setDragging] = useState(false)
    const descriptionId = `${id}-description`
    const errorId = `${id}-error`
    const describedBy = [descriptionId, error ? errorId : ""].filter(Boolean).join(" ")

    return (
        <div className={styles.field} role="group" aria-labelledby={`${id}-label`}>
            <span id={`${id}-label`} className={styles.label}>
                {label}
            </span>
            <div
                className={[
                    styles.upload,
                    dragging && !disabled ? styles.dragging : "",
                    disabled ? styles.disabled : "",
                    error ? styles.invalid : ""
                ]
                    .filter(Boolean)
                    .join(" ")}
                onDragEnter={(event) => {
                    if (disabled || !event.dataTransfer.types.includes("Files")) return
                    event.preventDefault()
                    dragDepth.current += 1
                    setDragging(true)
                }}
                onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = disabled ? "none" : "copy"
                }}
                onDragLeave={() => {
                    dragDepth.current = Math.max(0, dragDepth.current - 1)
                    if (!dragDepth.current) setDragging(false)
                }}
                onDrop={(event) => {
                    event.preventDefault()
                    dragDepth.current = 0
                    setDragging(false)
                    if (!disabled && event.dataTransfer.files[0]) onChange(event.dataTransfer.files[0])
                }}
            >
                <input
                    ref={input}
                    type="file"
                    hidden
                    accept={accept}
                    disabled={disabled}
                    aria-label={label}
                    onChange={(event) => {
                        const selected = event.currentTarget.files?.[0]
                        event.currentTarget.value = ""
                        if (selected) onChange(selected)
                    }}
                />
                <FiFileText className={styles.fileIcon} aria-hidden="true" />
                <div className={styles.details}>
                    <span className={styles.fileName} title={file?.name} aria-live="polite">
                        {file?.name ?? "Перетащите файл сюда"}
                    </span>
                    <span id={descriptionId} className={styles.hint}>
                        {file ? `${Math.ceil(file.size / 1024)} КБ · ${hint}` : hint}
                    </span>
                </div>
                <div className={styles.actions}>
                    <Button
                        variant="secondary"
                        className={styles.choose}
                        disabled={disabled}
                        aria-describedby={describedBy}
                        onClick={() => input.current?.click()}
                    >
                        <FiUpload aria-hidden="true" />
                        {file ? "Заменить файл" : "Выбрать файл"}
                    </Button>
                    {file ? (
                        <IconButton
                            size="sm"
                            disabled={disabled}
                            aria-label="Убрать выбранный файл"
                            title="Убрать файл"
                            onClick={() => onChange(null)}
                        >
                            <FiX aria-hidden="true" />
                        </IconButton>
                    ) : null}
                </div>
            </div>
            {error ? (
                <p id={errorId} className={styles.error} role="alert">
                    {error}
                </p>
            ) : null}
        </div>
    )
}
