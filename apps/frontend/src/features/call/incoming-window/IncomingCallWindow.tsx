import { useState } from "react"
import { FaPhone, FaPhoneSlash } from "react-icons/fa"
import { AvatarWithEffect } from "../../../pages/Profile/AvatarWithEffect"
import { BannerWithEffect } from "../../../pages/Profile/BannerWithEffect"
import { publicAssetUrl } from "../../../utils/publicAssetUrl"
import type { IncomingCallWindowState } from "../incomingCallWindowTypes"
import styles from "./IncomingCallWindow.module.css"

export function IncomingCallWindow({
    call,
    onAnswer
}: {
    call: IncomingCallWindowState
    onAnswer: (accept: boolean) => void
}) {
    const [failedAvatar, setFailedAvatar] = useState<string | null>(null)
    const [failedBanner, setFailedBanner] = useState<string | null>(null)
    const avatar = call.avatar && call.avatar !== failedAvatar ? call.avatar : null
    const banner = call.profileBanner && call.profileBanner !== failedBanner ? call.profileBanner : null
    const initials = Array.from(call.from.trim()).slice(0, 2).join("").toUpperCase() || "?"

    return (
        <main className={styles.window} aria-labelledby="incoming-call-type incoming-call-caller">
            <div className={styles.hero}>
                <BannerWithEffect
                    className={styles.banner}
                    effect={call.profileBannerEffect ?? "none"}
                    sticker={call.profileBannerSticker ?? "none"}
                >
                    {banner && <img src={banner} alt="" onError={() => setFailedBanner(banner)} />}
                </BannerWithEffect>
                <header className={styles.header}>
                    <span className={styles.callType} id="incoming-call-type">
                        <FaPhone size={12} aria-hidden />
                        Входящий звонок
                    </span>
                    <img src={publicAssetUrl("assets/PlayTime.png")} alt="PlayTime" />
                </header>
            </div>
            <div className={styles.identity}>
                <div className={styles.avatar}>
                    <AvatarWithEffect effect={call.profileAvatarEffect ?? "none"}>
                        {avatar ? (
                            <img src={avatar} alt="" onError={() => setFailedAvatar(avatar)} />
                        ) : (
                            <span className={styles.initials} aria-hidden>
                                {initials}
                            </span>
                        )}
                    </AvatarWithEffect>
                </div>
                <h1 id="incoming-call-caller" title={call.from}>
                    {call.from}
                </h1>
                {call.error && (
                    <p className={`${styles.feedback} ${styles.error}`} role="alert" title={call.error}>
                        {call.error}
                    </p>
                )}
                {call.busy && (
                    <p className={styles.feedback} role="status">
                        Отправляем ответ…
                    </p>
                )}
            </div>
            <div className={styles.actions} aria-busy={call.busy}>
                <button className={styles.accept} type="button" disabled={call.busy} onClick={() => onAnswer(true)}>
                    <FaPhone aria-hidden />
                    Принять
                </button>
                <button className={styles.decline} type="button" disabled={call.busy} onClick={() => onAnswer(false)}>
                    <FaPhoneSlash aria-hidden />
                    Отклонить
                </button>
            </div>
        </main>
    )
}
