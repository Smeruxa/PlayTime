import styles from "./Friends.module.css"

type FriendsRemoveConfirmModalProps = {
    username: string
    onClose: () => void
    onConfirm: () => void
}

export function FriendsRemoveConfirmModal({ username, onClose, onConfirm }: FriendsRemoveConfirmModalProps) {
    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
                <p className={styles.modalText}>
                    Вы уверены, что хотите удалить из друзей <strong>{username}</strong>?
                </p>
                <div className={styles.modalActions}>
                    <button type="button" className={styles.modalBtnCancel} onClick={onClose}>
                        Отмена
                    </button>
                    <button
                        type="button"
                        className={styles.modalBtnConfirm}
                        onClick={() => {
                            onConfirm()
                            onClose()
                        }}
                    >
                        Да
                    </button>
                </div>
            </div>
        </div>
    )
}
