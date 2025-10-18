import styles from "./Titlebar.module.css"

export default function Titlebar() {
    const call = (fn?: (() => void)) => fn?.()
    return (
        <div className={styles.titlebar}>
            <div className={styles.dragRegion}></div>
            <div className={styles.windowButtons}>
                <button className={styles.minimize} onClick={() => call(window.windowControls?.minimize)}>—</button>
                <button className={styles.maximize} onClick={() => call(window.windowControls?.maximize)}>☐</button>
                <button className={styles.close} onClick={() => call(window.windowControls?.close)}>×</button>
            </div>
        </div>
    )
}