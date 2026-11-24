import { GlassOrbs } from "./GlassOrbs"
import s from "./SectionBackdrop.module.css"

type SectionBackdropProps = {
    variant?: "grid" | "grid-orbs" | "orbs"
}

export function SectionBackdrop({ variant = "grid-orbs" }: SectionBackdropProps) {
    return (
        <div className={s.backdrop} aria-hidden>
            {variant !== "orbs" ? <div className={s.grid} /> : null}
            {variant !== "grid" ? <GlassOrbs intensity="soft" /> : null}
        </div>
    )
}
