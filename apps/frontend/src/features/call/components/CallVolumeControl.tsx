import { FaVolumeUp } from "react-icons/fa"
import Slider from "../../../components/Slider/Slider"
import styles from "../CallPanel.module.css"

type Props = {
    value: number
    onChange: (n: number) => void
    ariaLabel?: string
    className?: string
    wide?: boolean
}

export function CallVolumeControl({
    value,
    onChange,
    ariaLabel = "Громкость",
    className,
    wide = false
}: Props) {
    const wrapClass = [styles.volumeControl, wide ? styles.volumeControlWide : "", className]
        .filter(Boolean)
        .join(" ")

    return (
        <div className={wrapClass} title={ariaLabel}>
            <span className={styles.volumeIcon} aria-hidden>
                <FaVolumeUp size={14} />
            </span>
            <Slider
                type="range"
                min={0}
                max={100}
                className={styles.volumeSliderTrack}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                aria-label={ariaLabel}
            />
            <span className={styles.volumeBadge} aria-hidden>
                {value}%
            </span>
        </div>
    )
}
