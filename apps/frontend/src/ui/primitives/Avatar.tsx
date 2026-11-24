import { AvatarWithEffect } from "../../pages/Profile/AvatarWithEffect"
import styles from "./Avatar.module.css"

type AvatarProps = {
    name: string
    imageUrl?: string | null
    effect?: string
    size?: "sm" | "md" | "lg"
    isRoom?: boolean
}

export function Avatar({ name, imageUrl, effect = "none", size = "sm", isRoom = false }: AvatarProps) {
    const initial = (name.trim().charAt(0) || "?").toUpperCase()
    const sizeCls = size === "lg" ? styles.sizeLg : size === "md" ? styles.sizeMd : styles.sizeSm

    if (isRoom) {
        return (
            <div className={[styles.wrap, sizeCls].join(" ")}>
                <span className={[styles.initial, styles.room].join(" ")}>{initial}</span>
            </div>
        )
    }

    return (
        <div className={[styles.wrap, sizeCls].join(" ")}>
            <AvatarWithEffect effect={effect} className={styles.fxFill}>
                {imageUrl ? (
                    <img src={imageUrl} alt="" className={styles.img} />
                ) : (
                    <span className={styles.initial}>{initial}</span>
                )}
            </AvatarWithEffect>
        </div>
    )
}
