import { useNavigate } from "react-router-dom"
import { FiArrowRight, FiUser, FiShield } from "react-icons/fi"
import styles from "./Auth.module.css"

export default function WelcomePage() {
    const navigate = useNavigate()
    return (
        <div className={styles.body}>
            <section className={`${styles.mainWrapper} ${styles.welcome}`}>
                <div className={styles.heading}>
                    <span className={styles.brand}>
                        PlayTime <span className={styles.webBadge}>WEB</span>
                    </span>
                    <h1 className={styles.title}>Ближе, даже на расстоянии</h1>
                    <p className={styles.description}>Чаты, звонки и ваши комнаты — прямо в браузере. Как начнём?</p>
                </div>
                <div className={styles.choices}>
                    <button className={styles.choice} onClick={() => navigate("/guest")}>
                        <span className={styles.choiceIcon}>
                            <FiUser />
                        </span>
                        <span>
                            <strong>Войти по нику</strong>
                            <small>Только никнейм. Аккаунт можно зарегистрировать позже.</small>
                        </span>
                        <FiArrowRight aria-hidden />
                    </button>
                    <button className={styles.choice} onClick={() => navigate("/registration")}>
                        <span className={styles.choiceIcon}>
                            <FiShield />
                        </span>
                        <span>
                            <strong>Создать аккаунт</strong>
                            <small>Почта и пароль для входа с любого устройства.</small>
                        </span>
                        <FiArrowRight aria-hidden />
                    </button>
                </div>
                <div className={styles.registration}>
                    <span>Уже с нами?</span>
                    <button className={styles.registrationLink} onClick={() => navigate("/login")}>
                        Войти в аккаунт
                    </button>
                </div>
                <a className={styles.backLink} href="/playtime/">
                    На главную PlayTime
                </a>
            </section>
        </div>
    )
}
