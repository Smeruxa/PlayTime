import Slider from "../../../components/Slider/Slider"
import styles from "./DmWallpaperAdjustSliders.module.css"

type DmWallpaperAdjustSlidersProps = {
    dim: number
    blur: number
    disabled?: boolean
    onDimChange: (value: number) => void
    onBlurChange: (value: number) => void
}

export function DmWallpaperAdjustSliders({
    dim,
    blur,
    disabled,
    onDimChange,
    onBlurChange
}: DmWallpaperAdjustSlidersProps) {
    return (
        <div className={styles.root}>
            <div className={styles.field}>
                <div className={styles.fieldHead}>
                    <span className={styles.fieldLabel}>Затемнение</span>
                    <span className={styles.fieldValue}>{dim}</span>
                </div>
                <Slider
                    min={0}
                    max={100}
                    value={dim}
                    onChange={(e) => onDimChange(Number(e.target.value))}
                    disabled={disabled}
                />
                <p className={styles.fieldHint}>Выше — темнее слой поверх фото.</p>
            </div>
            <div className={styles.field}>
                <div className={styles.fieldHead}>
                    <span className={styles.fieldLabel}>Размытие</span>
                    <span className={styles.fieldValue}>{blur}</span>
                </div>
                <Slider
                    min={0}
                    max={100}
                    value={blur}
                    onChange={(e) => onBlurChange(Number(e.target.value))}
                    disabled={disabled}
                />
                <p className={styles.fieldHint}>Размывается только фоновое фото, текст чата остаётся чётким.</p>
            </div>
        </div>
    )
}
