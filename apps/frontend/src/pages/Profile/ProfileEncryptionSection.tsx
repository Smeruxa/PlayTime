import { useEffect, useState } from "react"
import { useSessionSocket } from "../../server/socketContext"
import { FileUpload, Modal } from "../../ui"
import { flushKeys, hydrateKeys, replaceKeys, snapshotKeys } from "../../features/chat/keyVault"
import { decryptKeyBackup, encryptKeyBackup } from "../../features/chat/keyBackup"
import { createAndStoreDmKeyPair, getDmPublicKeyB64, profileSetDmPublicKey } from "../../features/chat/dmE2ee"
import { keyFingerprint } from "../../features/chat/peerKeyTrust"
import styles from "./ProfileAccount.module.css"

export function ProfileEncryptionSection({ mode, onClose }: { mode: "backup" | "restore"; onClose: () => void }) {
    const { myUserId, socket } = useSessionSocket()
    const [password, setPassword] = useState("")
    const [file, setFile] = useState<File | null>(null)
    const [fileError, setFileError] = useState("")
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState("")
    const [fingerprint, setFingerprint] = useState("")
    const [messageIsError, setMessageIsError] = useState(false)
    const [completed, setCompleted] = useState(false)
    useEffect(() => {
        let active = true
        if (myUserId != null)
            void hydrateKeys(myUserId)
                .then(() => {
                    const key = getDmPublicKeyB64(myUserId)
                    return key ? keyFingerprint(key) : "Ключ не восстановлен"
                })
                .then((value) => {
                    if (active) setFingerprint(value)
                })
                .catch(() => {})
        return () => {
            active = false
        }
    }, [myUserId, message])
    const startNew = async () => {
        if (
            myUserId == null ||
            !socket?.connected ||
            !window.confirm(
                "Старые зашифрованные сообщения не откроются с новым ключом. Продолжить без восстановления истории?"
            )
        )
            return
        setBusy(true)
        setMessage("")
        setMessageIsError(false)
        try {
            await hydrateKeys(myUserId)
            await flushKeys(myUserId)
            const previous = snapshotKeys(myUserId)
            const key = await createAndStoreDmKeyPair(myUserId)
            const result = await profileSetDmPublicKey(socket, key, true)
            if (!result.ok) {
                await replaceKeys(myUserId, previous)
                throw new Error(result.err)
            }
            window.dispatchEvent(new Event("playtime:keys-updated"))
            setMessage("Создан новый ключ. Сохраните его резервную копию.")
        } catch (error) {
            setMessageIsError(true)
            setMessage(error instanceof Error ? error.message : "Не удалось создать ключ")
        } finally {
            setBusy(false)
        }
    }
    const run = async (restore: boolean) => {
        if (myUserId == null || !socket?.connected) return
        setBusy(true)
        setMessage("")
        setMessageIsError(false)
        try {
            await hydrateKeys(myUserId)
            if (restore) {
                if (!file) throw new Error("Выберите файл резервной копии")
                if (file.size > 256_000) throw new Error("Файл копии слишком большой")
                const keys = await decryptKeyBackup(await file.text(), myUserId, password)
                const previous = snapshotKeys(myUserId)
                if (
                    previous.dm &&
                    previous.dm !== keys.dm &&
                    !window.confirm(
                        "Копия содержит другой ключ. Существующие ключи этого устройства будут заменены. Сначала сохраните их резервную копию."
                    )
                )
                    return
                await replaceKeys(myUserId, keys)
                const res = await profileSetDmPublicKey(socket, getDmPublicKeyB64(myUserId), true)
                if (!res.ok) {
                    await replaceKeys(myUserId, previous)
                    throw new Error(res.err)
                }
                window.dispatchEvent(new Event("playtime:keys-updated"))
                setMessage("Ключи восстановлены. Переписка будет доступна после повторного открытия чата.")
            } else {
                const contents = await encryptKeyBackup(myUserId, snapshotKeys(myUserId), password)
                const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }))
                const link = document.createElement("a")
                link.href = url
                link.download = `playtime-keys-${myUserId}.json`
                link.click()
                window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
                setMessage("Копия сохранена. Храните файл и пароль отдельно.")
            }
            setPassword("")
            setCompleted(true)
        } catch (error) {
            setMessageIsError(true)
            setMessage(error instanceof Error ? error.message : "Не удалось сохранить ключи")
        } finally {
            setBusy(false)
        }
    }
    return (
        <Modal
            title={mode === "backup" ? "Сохранить резервную копию" : "Восстановить из копии"}
            onClose={() => {
                if (!busy) onClose()
            }}
            panelClassName={styles.modal}
            footer={
                <>
                    <button type="button" className={styles.button} disabled={busy} onClick={onClose}>
                        {completed ? "Готово" : "Отмена"}
                    </button>
                    {!completed ? (
                        <button
                            type="button"
                            className={`${styles.button} ${styles.primary}`}
                            onClick={() => void run(mode === "restore")}
                            disabled={
                                busy || !socket?.connected || password.length < 12 || (mode === "restore" && !file)
                            }
                        >
                            {busy ? "Подождите…" : mode === "backup" ? "Сохранить копию" : "Восстановить"}
                        </button>
                    ) : null}
                </>
            }
        >
            <div className={styles.modalBody}>
                {!completed ? (
                    <>
                        <p className={styles.hint}>
                            {mode === "backup"
                                ? "Зашифрованная копия ключей поможет открыть историю после переустановки PlayTime."
                                : "Выберите сохранённый файл и введите пароль, заданный при создании копии."}
                        </p>
                        {mode === "restore" ? (
                            <FileUpload
                                label="Файл резервной копии"
                                hint="Файл .json · до 250 КБ"
                                accept="application/json,.json"
                                file={file}
                                disabled={busy}
                                error={fileError}
                                onChange={(selected) => {
                                    const error =
                                        selected && !/\.json$/i.test(selected.name)
                                            ? "Выберите резервную копию в формате .json"
                                            : selected && selected.size > 256_000
                                              ? "Файл копии слишком большой. Максимум — 250 КБ."
                                              : ""
                                    setFileError(error)
                                    setFile(error ? null : selected)
                                }}
                            />
                        ) : null}
                        <label className={styles.label} htmlFor="key-backup-password">
                            {mode === "backup" ? "Пароль резервной копии" : "Пароль от копии"}
                            <input
                                id="key-backup-password"
                                className={styles.input}
                                type="password"
                                autoComplete={mode === "backup" ? "new-password" : "off"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={busy}
                                placeholder="Не менее 12 символов"
                            />
                        </label>
                        <p className={styles.hint}>
                            {mode === "backup"
                                ? "Выберите отдельный пароль для файла. Он понадобится при восстановлении."
                                : "Ключи из копии заменят ключи этого устройства. Пароль аккаунта для этого не подходит."}
                        </p>
                        <details className={styles.advanced}>
                            <summary>Мой ключ переписки</summary>
                            <div className={styles.advancedBody}>
                                <p className={styles.hint}>Отпечаток ключа на этом устройстве</p>
                                <code className={styles.fingerprint}>{fingerprint || "Загрузка…"}</code>
                                <div>
                                    <button
                                        type="button"
                                        className={`${styles.button} ${styles.link} ${styles.danger}`}
                                        onClick={() => void startNew()}
                                        disabled={busy || !socket?.connected}
                                    >
                                        Создать новый ключ
                                    </button>
                                </div>
                            </div>
                        </details>
                    </>
                ) : null}
                {message ? (
                    <p
                        className={messageIsError ? styles.error : styles.message}
                        role={messageIsError ? "alert" : "status"}
                    >
                        {message}
                    </p>
                ) : null}
            </div>
        </Modal>
    )
}
