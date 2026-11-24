import { useState, type ChangeEvent } from "react"
import { FiArchive, FiArrowRight, FiArrowUpRight, FiRefreshCw } from "react-icons/fi"
import { Modal } from "../../ui"
import { ProfilePasswordSection } from "./ProfilePasswordSection"
import { ProfileAccountSection } from "./ProfileAccountSection"
import { ProfileEncryptionSection } from "./ProfileEncryptionSection"
import { ProfileSessionsSection } from "./ProfileSessionsSection"
import { ProfileKeyTransferSection } from "./ProfileKeyTransferSection"
import styles from "./ProfileAccount.module.css"
import { useAccountStatus } from "../../auth/AccountStatus"
import { useNavigate } from "react-router-dom"

type ProfileAccountTabProps = {
    currentPassword: string
    password: string
    passwordRepeat: string
    errorPassword: string | null
    successPassword: string | null
    passwordSaving: boolean
    deleteAccountPassword: string
    deleteAccountErr: string | null
    deletingAccount: boolean
    socketConnected: boolean
    onCurrentChange: (e: ChangeEvent<HTMLInputElement>) => void
    onNewChange: (e: ChangeEvent<HTMLInputElement>) => void
    onRepeatChange: (e: ChangeEvent<HTMLInputElement>) => void
    onChangePassword: () => void
    onResetPassword: () => void
    onDeletePasswordChange: (e: ChangeEvent<HTMLInputElement>) => void
    onResetDelete: () => void
    onHoldComplete: () => void
}

export function ProfileAccountTab(props: ProfileAccountTabProps) {
    const { account } = useAccountStatus()
    const navigate = useNavigate()
    const [dialog, setDialog] = useState<"transfer" | "backup" | "restore" | "password" | "delete" | null>(null)
    const closePassword = () => {
        if (props.passwordSaving) return
        props.onResetPassword()
        setDialog(null)
    }
    const closeDelete = () => {
        if (props.deletingAccount) return
        props.onResetDelete()
        setDialog(null)
    }
    if (account?.isGuest)
        return (
            <div className={styles.container}>
                <section className={styles.card}>
                    <h2 className={styles.title}>Сохраните доступ к аккаунту</h2>
                    <p className={styles.description}>
                        {account.registrationPending
                            ? "Подтвердите почту, чтобы завершить регистрацию."
                            : "Вы вошли по нику. Добавьте почту и пароль, чтобы управлять входом и подключать другие устройства."}
                    </p>
                    <button
                        className={`${styles.button} ${styles.primary}`}
                        onClick={() => navigate("/complete-account")}
                    >
                        {account.registrationPending ? "Подтвердить почту" : "Зарегистрировать аккаунт"}{" "}
                        <FiArrowRight aria-hidden />
                    </button>
                </section>
            </div>
        )
    return (
        <div className={styles.container}>
            <div className={styles.grid}>
                <ProfileSessionsSection />
                <section className={styles.card} aria-labelledby="account-transfer-heading">
                    <div className={styles.icon}>
                        <FiRefreshCw aria-hidden />
                    </div>
                    <h2 id="account-transfer-heading" className={styles.title}>
                        На другом устройстве
                    </h2>
                    <p className={styles.description}>Продолжите разговоры на другом компьютере с той же историей.</p>
                    <button
                        type="button"
                        className={`${styles.button} ${styles.primary}`}
                        onClick={() => setDialog("transfer")}
                    >
                        Подключить устройство <FiArrowUpRight aria-hidden />
                    </button>
                </section>
                <section className={styles.card} aria-labelledby="account-backup-heading">
                    <div className={styles.icon}>
                        <FiArchive aria-hidden />
                    </div>
                    <h2 id="account-backup-heading" className={styles.title}>
                        Резервная копия
                    </h2>
                    <p className={styles.description}>
                        Сохраните доступ к переписке на случай переустановки приложения.
                    </p>
                    <div className={styles.actions}>
                        <button type="button" className={styles.button} onClick={() => setDialog("backup")}>
                            Сохранить
                        </button>
                        <button
                            type="button"
                            className={`${styles.button} ${styles.link}`}
                            onClick={() => setDialog("restore")}
                        >
                            Восстановить
                        </button>
                    </div>
                </section>
                <section
                    className={`${styles.card} ${styles.wide} ${styles.passwordRow}`}
                    aria-labelledby="account-password-heading"
                >
                    <div>
                        <h2 id="account-password-heading" className={styles.title}>
                            Пароль аккаунта
                        </h2>
                        <p className={styles.hint}>Для входа в PlayTime на ваших устройствах.</p>
                    </div>
                    <button type="button" className={styles.button} onClick={() => setDialog("password")}>
                        Изменить пароль
                    </button>
                </section>
            </div>
            <section className={styles.dangerRow} aria-labelledby="account-delete-heading">
                <div>
                    <h2 id="account-delete-heading">Удаление аккаунта</h2>
                    <p className={styles.hint}>Профиль и переписки будут удалены безвозвратно.</p>
                </div>
                <button
                    type="button"
                    className={`${styles.button} ${styles.link} ${styles.danger}`}
                    onClick={() => setDialog("delete")}
                >
                    Удалить аккаунт <FiArrowRight aria-hidden />
                </button>
            </section>
            {dialog === "transfer" ? <ProfileKeyTransferSection onClose={() => setDialog(null)} /> : null}
            {dialog === "backup" || dialog === "restore" ? (
                <ProfileEncryptionSection mode={dialog} onClose={() => setDialog(null)} />
            ) : null}
            {dialog === "password" ? (
                <Modal title="Изменить пароль" onClose={closePassword} panelClassName={styles.modal}>
                    <ProfilePasswordSection
                        currentPassword={props.currentPassword}
                        password={props.password}
                        passwordRepeat={props.passwordRepeat}
                        errorPassword={props.errorPassword}
                        successPassword={props.successPassword}
                        saving={props.passwordSaving}
                        disabled={!props.socketConnected}
                        onCurrentChange={props.onCurrentChange}
                        onNewChange={props.onNewChange}
                        onRepeatChange={props.onRepeatChange}
                        onChangePassword={props.onChangePassword}
                    />
                </Modal>
            ) : null}
            {dialog === "delete" ? (
                <Modal title="Удалить аккаунт?" onClose={closeDelete} panelClassName={styles.modal}>
                    <ProfileAccountSection
                        deleteAccountPassword={props.deleteAccountPassword}
                        deleteAccountErr={props.deleteAccountErr}
                        socketConnected={props.socketConnected}
                        busy={props.deletingAccount}
                        onPasswordChange={props.onDeletePasswordChange}
                        onHoldComplete={props.onHoldComplete}
                    />
                </Modal>
            ) : null}
        </div>
    )
}
