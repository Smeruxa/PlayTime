import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useSocket } from "../../server/SocketContext"
import { FaArrowLeft } from "react-icons/fa"
import styles from "./Profile.module.css"

export default function Profile() {
    const navigate = useNavigate()
    const { socket } = useSocket()
    const [username, setUsername] = useState("")

    const [password, setPassword] = useState("")
    const [passwordRepeat, setRepeatPassword] = useState("")
    
    const [errorPassword, setErrorPassword] = useState<string | null>(null)
    const [successPassword, setSuccessPassword] = useState<string | null>(null)

    // eslint-disable-next-line
    const [privacy, setPrivacy] = useState(false)

    useEffect(() => {
        if (!socket) return
        socket.emit("get:username", (username: string) => setUsername(username))
    }, [socket])

    const changePassword = () => {
        if (!socket) return

        const u = (s: string) => {
            setErrorPassword(s)
            setSuccessPassword(null)
        }

        if (!password || !passwordRepeat) return u("Пожалуйста, заполните оба поля")
        if (password !== passwordRepeat) return u("Пароли не совпадают")
        if (password.length < 3 || password.length > 30) return u("Пароль должен быть от 3 до 30 символов")

        socket.emit("user:changePassword", { newPassword: password }, (res: { success: boolean; err?: string }) => {
            if (res.success) {
                setErrorPassword(null)
                setSuccessPassword("Пароль успешно изменён")
            } else {
                setErrorPassword("Ошибка: " + res.err)
            }
        })
    }

    return (
        <div className={styles.body}>
            <div className={styles.card}>
                <div className={styles.userSection}>
                    <div className={styles.avatar}></div>
                    <span className={styles.username}>{username || "Loading.."}</span>
                </div>
                <div className={styles.settingsSection}>
                    <div className={styles.settingsHeader}>
                        <span className={styles.sectionTitle}>Настройки</span>
                        <FaArrowLeft className={styles.arrow} onClick={() => navigate("/content")} />
                    </div>
                    <div className={styles.settings}>
                        <div className={styles.passwordChange}>
                            <span>Изменить пароль</span>
                            <div className={styles.passwordGroup}>
                                <div className={styles.inputGroup}>
                                    <input placeholder="Введите пароль" className={styles.input} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
                                    <input placeholder="Повторите пароль" className={styles.input} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRepeatPassword(e.target.value)} onPaste={(e) => e.preventDefault()} />
                                </div>
                                <button className={styles.button} onClick={changePassword}>OK</button>
                            </div>
                            { errorPassword ? <span className={styles.passwordError}>{errorPassword}</span> : null }
                            { successPassword ? <span className={styles.successMessage}>{successPassword}</span> : null }
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}