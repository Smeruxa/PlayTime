import { VolumeOnIcon, VolumeOffIcon } from "./TalkScreenShareIcons"
import styles from "./ScreenShareVolume.module.css"

type Props = {
    volume: number
    muted: boolean
    onToggleMuted: () => void
    onVolumeChange: (value: number) => void
}

export default function ScreenShareVolume({ volume, muted, onToggleMuted, onVolumeChange }: Props) {
    const level = muted ? 0 : volume
    return (
        <div className={styles.volume} role="group" aria-label="Звук демонстрации">
            <button
                type="button"
                className={styles.mute}
                onClick={onToggleMuted}
                title={level === 0 ? "Включить звук демонстрации" : "Выключить звук демонстрации"}
                aria-label={level === 0 ? "Включить звук демонстрации" : "Выключить звук демонстрации"}
                aria-pressed={level === 0}
            >
                {level === 0 ? <VolumeOffIcon /> : <VolumeOnIcon />}
            </button>
            <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={level}
                aria-label="Громкость демонстрации"
                aria-valuetext={`${level}%`}
                onChange={(event) => onVolumeChange(Number(event.currentTarget.value))}
            />
            <output aria-hidden="true">{level}%</output>
        </div>
    )
}
