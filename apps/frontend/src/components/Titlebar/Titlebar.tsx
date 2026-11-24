import { memo } from "react"
import styles from "./Titlebar.module.css"
import { FaMinus, FaRegSquare, FaTimes } from "react-icons/fa"
import { publicAssetUrl } from "../../utils/publicAssetUrl"
import { useAppUpdate } from "../../hooks/useAppUpdate"

function Titlebar() {
    const call = (fn?: () => void) => fn?.()
    const { state, install, openDownload, retry } = useAppUpdate()

    if (!window.electronAPI) return null

    return (
        <div className={styles.titlebar}>
            <div className={styles.titleWrapper}>
                <img src={publicAssetUrl("assets/PlayTime.png")} alt="" className={styles.titleImage} />
                <div className={styles.title}>PlayTime</div>
                {state.kind === "downloaded" ? (
                    <button type="button" className={styles.updateBtn} onClick={install}>
                        Перезапустить ({state.version})
                    </button>
                ) : state.kind === "manual" ? (
                    <button
                        type="button"
                        className={styles.updateBtn}
                        onClick={openDownload}
                        title="Открыть страницу загрузки"
                    >
                        Скачать ({state.version})
                    </button>
                ) : state.kind === "error" ? (
                    <>
                        <span role="alert" className={styles.updateHint} title={state.message}>
                            {state.version ? "Обновление не установлено" : "Не удалось проверить обновления"}
                        </span>
                        <button
                            type="button"
                            className={styles.updateBtn}
                            onClick={state.version ? openDownload : retry}
                        >
                            {state.version ? "Скачать обновление" : "Повторить"}
                        </button>
                    </>
                ) : state.kind === "preparing" || state.kind === "installing" ? (
                    <span role="status" className={styles.updateHint}>
                        {state.kind === "preparing" ? "Подготовка обновления…" : "Перезапуск…"}
                    </span>
                ) : state.kind === "available" ? (
                    <span className={styles.updateHint}>Обновление {state.version}…</span>
                ) : null}
            </div>
            <div className={styles.windowButtons}>
                <button type="button" onClick={() => call(window.windowControls?.minimize)} aria-label="Свернуть">
                    <FaMinus className={styles.winIcon} />
                </button>
                <button type="button" onClick={() => call(window.windowControls?.maximize)} aria-label="Развернуть">
                    <FaRegSquare className={styles.winIcon} />
                </button>
                <button type="button" onClick={() => call(window.windowControls?.close)} aria-label="Закрыть">
                    <FaTimes className={styles.winIcon} />
                </button>
            </div>
        </div>
    )
}

export default memo(Titlebar)
