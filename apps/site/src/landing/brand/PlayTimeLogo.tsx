import s from "./PlayTimeLogo.module.css"

const iconUrl = `${import.meta.env.BASE_URL}assets/PlayTime.png`

type PlayTimeLogoProps = {
    showWordmark?: boolean
    size?: number
    className?: string
}

export function PlayTimeLogo({ showWordmark = true, size = 26, className }: PlayTimeLogoProps) {
    return (
        <span className={`${s.logo}${className ? ` ${className}` : ""}`}>
            <img src={iconUrl} alt="" className={s.icon} style={{ height: size }} decoding="async" />
            {showWordmark ? <span className={s.wordmark}>PlayTime</span> : null}
        </span>
    )
}
