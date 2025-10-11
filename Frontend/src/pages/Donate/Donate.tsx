import { FaArrowLeft } from "react-icons/fa"
import { IconContext } from "react-icons"
import { useNavigate } from "react-router-dom"
import styles from "./Donate.module.css"
import TinkoffCard from "../../components/TinkoffCard/TinkoffCard"

export default function Donate() {
    const navigate = useNavigate()

    return (
        <div className={styles.body}>
            <span>Донат на сервер ^_^</span>
            <div className={styles.donateWrapper}>
                <TinkoffCard accountNumber="2200 7008 0763 8506" />
                <span className={styles.backIcon} onClick={() => navigate("/content")}>
                    <IconContext.Provider value={{}}>
                        <FaArrowLeft />
                    </IconContext.Provider>
                </span>
            </div>
        </div>
    )
}
