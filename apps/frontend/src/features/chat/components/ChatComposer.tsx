import { ChatSendIcon } from "./ChatSendIcon"
import { ChatAttachmentIcon } from "./ChatAttachmentIcon"
import { RefObject, useRef, useState, lazy, Suspense, type ClipboardEvent } from "react"
import type { DisplayMessage } from "../types"
import type { VoiceRecorderPhase } from "../hooks/useVoiceRecorder"
import { VoiceMicGlyph, VoiceNoteShell } from "./VoiceNoteShell"
import styles from "../../../ui/chat/ComposerShell.module.css"
import shared from "../../../ui/chat/chatShared.module.css"
const ChatEmojiPicker = lazy(() => import("./ChatEmojiPicker").then((module) => ({ default: module.ChatEmojiPicker })))
import { ChatEmojiRichText } from "./ChatEmojiRichText"
import { ChatEmojiImg } from "./ChatEmojiImg"

function formatVoiceDuration(sec: number): string {
    const s = Math.max(0, Math.floor(sec))
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${r.toString().padStart(2, "0")}`
}

function insertAtCursor(el: HTMLTextAreaElement | null, insert: string, maxLen: number, onChange: (v: string) => void) {
    if (!el) return
    const text = el.value
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    const before = text.slice(0, start)
    const after = text.slice(end)
    const next = (before + insert + after).slice(0, maxLen)
    onChange(next)
    const pos = Math.min(start + insert.length, next.length)
    queueMicrotask(() => {
        el.focus()
        try {
            el.setSelectionRange(pos, pos)
        } catch {
        }
    })
}

export type ChatVoiceRecorderUi = {
    phase: VoiceRecorderPhase
    recordingSec: number
    previewUrl: string | null
    previewDurationSec: number
    busy: boolean
    chatDisabled: boolean
    onMic: () => void
    onStopRecord: () => void
    onCancelRecord: () => void
    onSendVoice: () => void
    onCancelPreview: () => void
}

type ChatComposerProps = {
    disabled?: boolean
    inputRef: RefObject<HTMLTextAreaElement | null>
    value: string
    onChange: (v: string) => void
    onSend: () => void
    replyTo?: DisplayMessage | null
    onCancelReply?: () => void
    maxLen?: number
    editingMessageId?: number | null
    onCancelEdit?: () => void
    onStopComposerTyping?: () => void
    voiceRecorder?: ChatVoiceRecorderUi | null
    attachBusy?: boolean
    attachDisabled?: boolean
    onAttachFile?: (file: File) => void
}

export function ChatComposer({
    disabled = false,
    inputRef,
    value,
    onChange,
    onSend,
    replyTo,
    onCancelReply,
    maxLen = 150,
    editingMessageId = null,
    onCancelEdit,
    onStopComposerTyping,
    voiceRecorder = null,
    attachBusy = false,
    attachDisabled = false,
    onAttachFile
}: ChatComposerProps) {
    const [emojiOpen, setEmojiOpen] = useState(false)
    const [emojiMountKey, setEmojiMountKey] = useState(0)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const isEditing = editingMessageId != null
    const vr = voiceRecorder
    const voiceBlocksText = vr && (vr.phase === "recording" || vr.phase === "preview")

    const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
        if (!onAttachFile || attachDisabled || attachBusy || voiceBlocksText || isEditing) return
        const items = e.clipboardData?.items
        if (!items) return
        for (const item of Array.from(items)) {
            if (item.kind !== "file") continue
            const file = item.getAsFile()
            if (file && file.type.startsWith("image/")) {
                e.preventDefault()
                onAttachFile(file)
                return
            }
        }
    }

    const preview =
        replyTo == null
            ? ""
            : replyTo.text.replace(/\s+/g, " ").trim().slice(0, 100) + (replyTo.text.length > 100 ? "…" : "")

    const openEmoji = () => {
        setEmojiMountKey((k) => k + 1)
        setEmojiOpen(true)
    }

    return (
        <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className={styles.inputBody}>
                <div className={styles.composerStack}>
                    {isEditing ? (
                        <div className={styles.composerEditBar}>
                            <span>Редактирование сообщения</span>
                            <button
                                type="button"
                                className={styles.composerEditCancel}
                                onClick={onCancelEdit}
                                title="Отменить"
                                aria-label="Отменить правку"
                            >
                                ×
                            </button>
                        </div>
                    ) : null}
                    {replyTo ? (
                        <div className={styles.composerReply}>
                            <div className={styles.composerReplyMeta}>
                                <span className={styles.composerReplyLabel}>Ответ</span>
                                <button
                                    type="button"
                                    className={styles.composerReplyCancel}
                                    onClick={onCancelReply}
                                    title="Отменить ответ"
                                >
                                    ×
                                </button>
                            </div>
                            <div className={styles.composerReplySnippet}>
                                {preview ? (
                                    <ChatEmojiRichText text={preview} imgClassName={shared.chatEmojiInline} />
                                ) : (
                                    "…"
                                )}
                            </div>
                        </div>
                    ) : null}
                    {vr && vr.phase === "recording" ? (
                        <div className={styles.voiceComposerBar} role="status" aria-live="polite">
                            <div className={styles.voiceRecordingRow}>
                                <div className={styles.voiceRecordingMeta}>
                                    <span className={styles.voiceRecordingPulse} aria-hidden />
                                    <span className={styles.voiceRecordingTitle}>Запись</span>
                                </div>
                                <span className={styles.voiceRecordingTime}>
                                    {formatVoiceDuration(vr.recordingSec)}
                                </span>
                                <span className={styles.voiceRecordingGrow} aria-hidden />
                                <button
                                    type="button"
                                    className={styles.voiceRecordingBtnCancel}
                                    onClick={vr.onCancelRecord}
                                >
                                    Отмена
                                </button>
                                <button
                                    type="button"
                                    className={styles.voiceRecordingBtnDone}
                                    onClick={vr.onStopRecord}
                                >
                                    Готово
                                </button>
                            </div>
                        </div>
                    ) : null}
                    {vr && vr.phase === "preview" && vr.previewUrl ? (
                        <div className={`${styles.voiceComposerBar} ${styles.voiceComposerBarPreview}`}>
                            <div className={styles.voiceComposerPreviewRow}>
                                <VoiceNoteShell
                                    src={vr.previewUrl}
                                    durationHintSec={vr.previewDurationSec}
                                    variant="composer"
                                />
                            </div>
                            <div className={styles.voiceComposerActions}>
                                <button
                                    type="button"
                                    className={styles.voiceBarButton}
                                    disabled={vr.busy}
                                    onClick={vr.onCancelPreview}
                                >
                                    Отменить
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.voiceBarButton} ${styles.voiceBarButtonPrimary}`}
                                    disabled={vr.busy}
                                    onClick={vr.onSendVoice}
                                >
                                    Отправить
                                </button>
                            </div>
                        </div>
                    ) : null}
                    <div className={styles.composerRow}>
                        <div className={styles.composerInputWrap}>
                            <div className={styles.composerEmojiAnchor}>
                                <button
                                    type="button"
                                    className={styles.emojiToggle}
                                    data-chat-emoji-toggle
                                    title="Смайлики"
                                    aria-expanded={emojiOpen}
                                    aria-haspopup="listbox"
                                    onClick={() => (emojiOpen ? setEmojiOpen(false) : openEmoji())}
                                >
                                    <ChatEmojiImg emoji="🙂" className={styles.emojiToggleImg} title="Смайлики" />
                                </button>
                                <Suspense fallback={<span role="status">Загрузка эмодзи…</span>}>
                                    <ChatEmojiPicker
                                        key={emojiMountKey}
                                        open={emojiOpen}
                                        onClose={() => setEmojiOpen(false)}
                                        onPick={(em) => insertAtCursor(inputRef.current, em, maxLen, onChange)}
                                    />
                                </Suspense>
                            </div>
                            <textarea
                                ref={inputRef}
                                onKeyDown={(e) => {
                                    if (e.key === "Escape" && isEditing) {
                                        e.preventDefault()
                                        onCancelEdit?.()
                                        return
                                    }
                                    if (voiceBlocksText) return
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault()
                                        onSend()
                                    }
                                }}
                                onPaste={handlePaste}
                                className={styles.composerInput}
                                placeholder={isEditing ? "Новый текст…" : "Сообщение…"}
                                rows={1}
                                value={value}
                                disabled={disabled || !!voiceBlocksText}
                                onChange={(e) => onChange(e.target.value.slice(0, maxLen))}
                                onBlur={() => onStopComposerTyping?.()}
                            />
                        </div>
                        {!isEditing && onAttachFile ? (
                            <>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*,.pdf,.txt,.zip"
                                    className={styles.hiddenFileInput}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0]
                                        e.target.value = ""
                                        if (file) onAttachFile(file)
                                    }}
                                />
                                <button
                                    type="button"
                                    className={styles.attachButton}
                                    disabled={attachBusy || attachDisabled || !!voiceBlocksText}
                                    title="Прикрепить файл"
                                    aria-label="Прикрепить файл"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <ChatAttachmentIcon className={styles.attachButtonGlyph} />
                                </button>
                            </>
                        ) : null}
                        {!isEditing && vr ? (
                            <button
                                type="button"
                                className={styles.micButton}
                                disabled={vr.phase !== "idle" || vr.busy || vr.chatDisabled}
                                title="Голосовое сообщение"
                                aria-label="Записать голосовое сообщение"
                                onClick={vr.onMic}
                            >
                                <VoiceMicGlyph className={styles.micButtonGlyph} />
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className={styles.sendButton}
                            onClick={onSend}
                            onMouseDown={(event) => event.preventDefault()}
                            title="Отправить"
                            aria-label="Отправить сообщение"
                            disabled={disabled || !!voiceBlocksText}
                        >
                            <ChatSendIcon className={styles.sendIcon} />
                        </button>
                    </div>
                </div>
            </div>
        </fieldset>
    )
}
