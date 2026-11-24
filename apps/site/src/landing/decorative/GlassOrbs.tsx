import s from "./GlassOrbs.module.css"

type GlassOrbsProps = {
    intensity?: "soft" | "strong"
    className?: string
}

export function GlassOrbs({ intensity = "soft", className }: GlassOrbsProps) {
    return (
        <div className={`${s.orbs}${className ? ` ${className}` : ""}`} data-intensity={intensity} aria-hidden>
            <div className={s.orb} data-i="1" />
            <div className={s.orb} data-i="2" />
            <div className={s.orb} data-i="3" />
        </div>
    )
}
