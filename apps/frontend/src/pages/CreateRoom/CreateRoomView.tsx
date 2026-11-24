import { useId, type ChangeEvent } from "react"
import { FaArrowLeft } from "react-icons/fa"
import { CreateRoomIllustration } from "./CreateRoomIllustration"
import styles from "./CreateRoom.module.css"

type CreateRoomViewProps = {
    name: string
    error: string | null
    onNameChange: (e: ChangeEvent<HTMLInputElement>) => void
    onCreate: () => void
    onCancel: () => void
}

export function CreateRoomView({ name, error, onNameChange, onCreate, onCancel }: CreateRoomViewProps) {
    const nameId = useId()

    return (
        <div className={styles.body}>
            <div className={styles.shell}>
                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <div className={styles.cardHeaderMain}>
                            <h1 className={styles.pageTitle}>Создать комнату</h1>
                            <p className={styles.pageSubtitle}>Групповой чат для нескольких участников</p>
                        </div>
                        <button type="button" className={styles.backToChats} onClick={onCancel}>
                            <FaArrowLeft className={styles.backToChatsIcon} aria-hidden />
                            К диалогам
                        </button>
                    </div>

                    <div className={styles.cardMain}>
                        <div className={styles.hero}>
                            <CreateRoomIllustration className={styles.heroArt} />
                        </div>

                        <div className={styles.formFooter}>
                            <p className={styles.tagline}>
                                Комнаты — беседа с множеством пользователей одновременно.
                            </p>

                            <div className={styles.formBlock}>
                            <label className={styles.fieldLabel} htmlFor={nameId}>
                                Название комнаты
                            </label>
                            <input
                                id={nameId}
                                placeholder="Например, Команда дизайна"
                                className={styles.input}
                                maxLength={15}
                                value={name}
                                onChange={onNameChange}
                                autoComplete="off"
                            />
                            <p className={styles.fieldHint}>От 3 до 15 символов — так участники узнают чат в списке.</p>
                            {error ? (
                                <p className={styles.error} role="alert">
                                    {error}
                                </p>
                            ) : null}

                            <div className={styles.actions}>
                                <button type="button" className={styles.btnPrimary} onClick={onCreate}>
                                    Создать комнату
                                </button>
                                <button type="button" className={styles.btnGhost} onClick={onCancel}>
                                    Отмена
                                </button>
                            </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
