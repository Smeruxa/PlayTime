import { normalizeAvatarEffect } from "../../profile/avatarEffects"
import { AvatarEffectOverlay } from "./effects/AvatarEffectOverlay"
import styles from "./AvatarWithEffect.module.css"

type AvatarWithEffectProps = {
    effect: string
    compact?: boolean
    className?: string
    children: React.ReactNode
}

export function AvatarWithEffect({ effect, compact, className, children }: AvatarWithEffectProps) {
    const id = normalizeAvatarEffect(effect)
    const wrapClass = [styles.wrap, id !== "none" ? styles.wrapActive : "", className].filter(Boolean).join(" ")

    return (
        <div className={wrapClass} data-effect={id}>
            {id !== "none" ? <AvatarEffectOverlay effectId={id} compact={compact} /> : null}
            <div className={styles.inner}>{children}</div>
        </div>
    )
}
