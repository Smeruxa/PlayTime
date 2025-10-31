import { FaArrowLeft, FaGift, FaMoneyBill } from "react-icons/fa"
import { IconContext } from "react-icons"
import { useNavigate } from "react-router-dom"
import styles from "./Donate.module.css"
import TinkoffCard from "../../components/TinkoffCard/TinkoffCard"

export default function Donate() {
    const navigate = useNavigate()

    return (
        <div className={styles.body}>
            <span className={styles.title}>Донат на сервер <FaMoneyBill /></span>
            <div className={styles.donateWrapper}>
                <TinkoffCard accountNumber="2200 7008 0763 8506" />
                <button className={styles.backButton} onClick={() => navigate("/content")}>
                    <IconContext.Provider value={{ size: "1.5em" }}>
                        <FaArrowLeft />
                    </IconContext.Provider>
                    Назад
                </button>
            </div>
            <div className={styles.extra}>
                <button className={styles.giftButton}>
                    <IconContext.Provider value={{ size: "1.2em" }}>
                        <FaGift />
                    </IconContext.Provider>
                    Подарить бонус
                </button>
            </div>
        </div>
    )
}