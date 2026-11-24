import { Modal } from "../../ui"
import styles from "./ProfileConfirmMediaModal.module.css"

type ProfileConfirmMediaModalProps = {
    kind: "avatar" | "banner"
    previewUrl: string
    saving?: boolean
    error?: string | null
    onConfirm: () => void
    onCancel: () => void
}

export function ProfileConfirmMediaModal({
    kind,
    previewUrl,
    saving,
    error,
    onConfirm,
    onCancel
}: ProfileConfirmMediaModalProps) {
    return (
        <Modal
            title={kind === "avatar" ? "Сохранить аватарку?" : "Сохранить новый баннер?"}
            panelClassName={styles.dialog}
            onClose={() => {
                if (!saving) onCancel()
            }}
            footer={
                <>
                    <button type="button" className={styles.btnGhost} disabled={saving} onClick={onCancel}>
                        Отмена
                    </button>
                    <button type="button" className={styles.btnPrimary} disabled={saving} onClick={onConfirm}>
                        {saving ? "Сохранение…" : "Сохранить"}
                    </button>
                </>
            }
        >
            <p className={styles.lead}>
                {kind === "avatar"
                    ? "Фото будет видно друзьям в PlayTime. После сохранения вы сможете снова изменить его в любой момент."
                    : "Баннер отображается в профиле для друзей. Можно заменить или убрать позже."}
            </p>
            <img src={previewUrl} alt="" className={kind === "avatar" ? styles.preview : styles.previewBanner} />
            {error ? (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            ) : null}
        </Modal>
    )
}
