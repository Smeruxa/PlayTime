import styles from "./Titlebar.module.css"
import { FaWindowMinimize, FaWindowMaximize, FaTimes } from "react-icons/fa"

export default function Titlebar() {
    const call = (fn?: (() => void)) => fn?.()
    return (
        <div className={styles.titlebar}>
            <div className={styles.titleWrapper}>
                <img src="./assets/favicon.ico" alt="img" className={styles.titleImage} />
                <div className={styles.title}>PlayTime</div>
            </div>
            <div className={styles.windowButtons}>
                <button className={styles.minimize} onClick={() => call(window.windowControls?.minimize)}><FaWindowMinimize /></button>
                <button className={styles.maximize} onClick={() => call(window.windowControls?.maximize)}><FaWindowMaximize /></button>
                <button className={styles.close} onClick={() => call(window.windowControls?.close)}><FaTimes /></button>
            </div>
        </div>
    )
}