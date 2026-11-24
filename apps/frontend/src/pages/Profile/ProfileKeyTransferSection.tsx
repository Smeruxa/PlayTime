import { useState } from "react"
import nacl from "tweetnacl"
import util from "tweetnacl-util"
import { API_BASE } from "../../config"
import { useSessionSocket } from "../../server/socketContext"
import { Modal } from "../../ui"
import { hydrateKeys, replaceKeys, snapshotKeys } from "../../features/chat/keyVault"
import { getDmPublicKeyB64, profileSetDmPublicKey } from "../../features/chat/dmE2ee"
import styles from "./ProfileAccount.module.css"

export function ProfileKeyTransferSection({ onClose }: { onClose: () => void }) {
    const { token, myUserId, socket } = useSessionSocket()
    const [code, setCode] = useState("")
    const [generated, setGenerated] = useState("")
    const [message, setMessage] = useState("")
    const [busy, setBusy] = useState(false)
    const [direction, setDirection] = useState<"send" | "receive">("send")
    const [messageIsError, setMessageIsError] = useState(false)
    const request = async (path: string, body: object) => {
        const response = await fetch(`${API_BASE}/auth/key-transfer${path}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body)
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || "Не удалось перенести ключи")
        return result
    }
    const run = async (receive: boolean) => {
        if (!myUserId || !socket?.connected || !token || busy) return
        setBusy(true)
        setMessage("")
        setMessageIsError(false)
        try {
            await hydrateKeys(myUserId)
            if (!receive) {
                const keys = snapshotKeys(myUserId)
                if (!keys.dm) throw new Error("Сначала восстановите ключ переписки на этом устройстве")
                const secret = nacl.randomBytes(32),
                    nonce = nacl.randomBytes(24)
                const ciphertext = nacl.secretbox(
                    util.decodeUTF8(JSON.stringify({ userId: myUserId, keys })),
                    nonce,
                    secret
                )
                const result = await request("/", {
                    ciphertext: util.encodeBase64(ciphertext),
                    nonce: util.encodeBase64(nonce)
                })
                setGenerated(`${result.id}.${util.encodeBase64(secret)}`)
                setMessage(
                    "Код действует 5 минут и используется один раз. Войдите в этот же аккаунт на втором устройстве и вставьте код здесь. Никому его не передавайте."
                )
            } else {
                const [id, key, extra] = code.trim().split(".")
                if (extra || !id || !key) throw new Error("Вставьте полный код с первого устройства")
                const secret = util.decodeBase64(key)
                if (secret.length !== 32) throw new Error("Неверный код переноса")
                if (!window.confirm("Ключи этого устройства будут заменены ключами с первого устройства. Продолжить?"))
                    return
                const bundle = await request(`/${id}/consume`, {})
                const plaintext = nacl.secretbox.open(
                    util.decodeBase64(bundle.ciphertext),
                    util.decodeBase64(bundle.nonce),
                    secret
                )
                if (!plaintext)
                    throw new Error("Не удалось расшифровать ключи. Создайте новый код на первом устройстве.")
                const decoded = JSON.parse(util.encodeUTF8(plaintext))
                if (
                    decoded.userId !== myUserId ||
                    !decoded.keys?.dm ||
                    Object.entries(decoded.keys).some(
                        ([name, value]) =>
                            !/^(dm|room:[1-9]\d*(?::[1-9]\d*)?)$/.test(name) ||
                            typeof value !== "string" ||
                            !/^[A-Za-z0-9+/]{43}=$/.test(value)
                    )
                )
                    throw new Error("Некорректный пакет ключей")
                const previous = snapshotKeys(myUserId)
                await replaceKeys(myUserId, decoded.keys)
                const published = await profileSetDmPublicKey(socket, getDmPublicKeyB64(myUserId), true)
                if (!published.ok) {
                    await replaceKeys(myUserId, previous)
                    throw new Error(published.err)
                }
                setCode("")
                setMessage("Ключи перенесены. Откройте переписку снова.")
                window.dispatchEvent(new Event("playtime:keys-updated"))
            }
        } catch (error) {
            setMessageIsError(true)
            setMessage(error instanceof Error ? error.message : "Не удалось перенести ключи")
        } finally {
            setBusy(false)
        }
    }
    return (
        <Modal
            title="Переписка на другом устройстве"
            onClose={() => {
                if (!busy) onClose()
            }}
            panelClassName={styles.modal}
            footer={
                <button type="button" className={styles.button} disabled={busy} onClick={onClose}>
                    Закрыть
                </button>
            }
        >
            <div className={styles.modalBody}>
                <p className={styles.hint}>
                    Передайте ключи между своими компьютерами, чтобы продолжить разговоры с той же историей.
                </p>
                <div className={styles.switch} role="group" aria-label="Направление переноса">
                    <button
                        type="button"
                        aria-pressed={direction === "send"}
                        disabled={busy}
                        onClick={() => {
                            setDirection("send")
                            setMessage("")
                        }}
                    >
                        Передать с этого
                    </button>
                    <button
                        type="button"
                        aria-pressed={direction === "receive"}
                        disabled={busy}
                        onClick={() => {
                            setDirection("receive")
                            setMessage("")
                        }}
                    >
                        Получить на этом
                    </button>
                </div>
                {direction === "send" ? (
                    <>
                        <ol className={styles.steps}>
                            <li>Создайте код на этом компьютере.</li>
                            <li>
                                Войдите в тот же аккаунт на втором устройстве и вставьте код в разделе Получить на
                                этом.
                            </li>
                        </ol>
                        <div>
                            <button
                                type="button"
                                className={`${styles.button} ${styles.primary}`}
                                disabled={busy || !token || !socket?.connected}
                                onClick={() => void run(false)}
                            >
                                {busy ? "Создание…" : generated ? "Создать новый код" : "Создать одноразовый код"}
                            </button>
                        </div>
                        {generated ? (
                            <>
                                <label className={styles.label}>
                                    Код переноса
                                    <input
                                        className={`${styles.input} ${styles.code}`}
                                        readOnly
                                        value={generated}
                                        onFocus={(event) => event.target.select()}
                                    />
                                </label>
                                <div>
                                    <button
                                        type="button"
                                        className={styles.button}
                                        onClick={() =>
                                            void navigator.clipboard
                                                .writeText(generated)
                                                .then(() => {
                                                    setMessageIsError(false)
                                                    setMessage("Код скопирован. Вставьте его на втором устройстве.")
                                                })
                                                .catch(() => {
                                                    setMessageIsError(true)
                                                    setMessage("Выделите и скопируйте код вручную.")
                                                })
                                        }
                                    >
                                        Скопировать код
                                    </button>
                                </div>
                            </>
                        ) : null}
                    </>
                ) : (
                    <form
                        className={styles.form}
                        onSubmit={(event) => {
                            event.preventDefault()
                            void run(true)
                        }}
                    >
                        <label className={styles.label} htmlFor="key-transfer-code">
                            Код с первого устройства
                            <input
                                id="key-transfer-code"
                                className={`${styles.input} ${styles.code}`}
                                autoComplete="off"
                                value={code}
                                onChange={(event) => setCode(event.target.value)}
                                placeholder="Вставьте полный код переноса"
                                disabled={busy}
                            />
                        </label>
                        <p className={styles.hint}>
                            Ключи этого устройства будут заменены. Сохраните их копию, если здесь есть другая история
                            переписки.
                        </p>
                        <div>
                            <button
                                type="submit"
                                className={`${styles.button} ${styles.primary}`}
                                disabled={busy || !code.trim() || !token || !socket?.connected}
                            >
                                {busy ? "Перенос…" : "Перенести на этот компьютер"}
                            </button>
                        </div>
                    </form>
                )}
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
