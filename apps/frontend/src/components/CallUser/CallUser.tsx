import { useEffect, useState } from "react"
import { AvatarWithEffect } from "../../pages/Profile/AvatarWithEffect"
import styles from "./CallUser.module.css"

interface CallProps {
    name: string
    avatarUrl?: string | null
    avatarEffect?: string
    size?: "md" | "lg"
    roleLabel?: string
    className?: string
}

export default function CallUser({
    name,
    avatarUrl,
    avatarEffect = "none",
    size = "md",
    roleLabel,
    className
}: CallProps) {
    const [imgBroken, setImgBroken] = useState(false)
    const rawName = (name ?? "").trim()
    const initial = (rawName.charAt(0) || "?").toUpperCase()
    const showImg = Boolean(avatarUrl) && !imgBroken

    useEffect(() => {
        setImgBroken(false)
    }, [avatarUrl])

    const bodyClass = [styles.body, size === "lg" ? styles.bodyLg : "", className].filter(Boolean).join(" ")

    return (
        <div className={bodyClass}>
            <div className={styles.avatar}>
                <AvatarWithEffect effect={avatarEffect} className={styles.avatarFx}>
                    {showImg ? (
                        <img src={avatarUrl!} alt="" className={styles.avatarImg} onError={() => setImgBroken(true)} />
                    ) : (
                        <span className={styles.avatarInitial}>{initial}</span>
                    )}
                </AvatarWithEffect>
            </div>
            <div className={styles.nameRow}>
                <span className={styles.name}>{name}</span>
                {roleLabel ? <span className={styles.roleBadge}>{roleLabel}</span> : null}
            </div>
        </div>
    )
}
