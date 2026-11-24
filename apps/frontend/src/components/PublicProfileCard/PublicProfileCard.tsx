import type { UserPublicProfile } from "../../types"
import { formatProfileDate } from "../../utils/compressAvatar"
import { AvatarWithEffect } from "../../pages/Profile/AvatarWithEffect"
import { BannerWithEffect } from "../../pages/Profile/BannerWithEffect"
import styles from "./PublicProfileCard.module.css"

export type PublicProfileCardData = Pick<
    UserPublicProfile,
    | "username"
    | "status"
    | "bio"
    | "avatar"
    | "profileBanner"
    | "profileAvatarEffect"
    | "profileBannerEffect"
    | "profileBannerSticker"
    | "createdAt"
>

export function PublicProfileCard({ profile }: { profile: PublicProfileCardData }) {
    return (
        <article
            className={styles.card}
            aria-label={`Карточка ${profile.username}`}
            data-profile-card={profile.username}
        >
            <div className={styles.hero}>
                <div className={styles.banner}>
                    <BannerWithEffect
                        effect={profile.profileBannerEffect ?? "none"}
                        sticker={profile.profileBannerSticker ?? "none"}
                    >
                        {profile.profileBanner ? (
                            <img src={profile.profileBanner} alt="" className={styles.bannerImage} />
                        ) : null}
                    </BannerWithEffect>
                    <div className={styles.avatar}>
                        <AvatarWithEffect effect={profile.profileAvatarEffect ?? "none"}>
                            {profile.avatar ? (
                                <img src={profile.avatar} alt="" className={styles.avatarImage} />
                            ) : (
                                <span className={styles.avatarFallback} aria-hidden>
                                    {(profile.username.trim().charAt(0) || "?").toUpperCase()}
                                </span>
                            )}
                        </AvatarWithEffect>
                    </div>
                </div>
                <div className={styles.identity}>
                    <h2 className={styles.name}>{profile.username}</h2>
                    <p className={`${styles.status}${profile.status ? "" : ` ${styles.statusEmpty}`}`}>
                        {profile.status || "Нет статуса"}
                    </p>
                </div>
            </div>
            <p className={styles.bio}>{profile.bio || "Пользователь пока ничего не написал о себе."}</p>
            {profile.createdAt ? (
                <p className={styles.meta}>В PlayTime с {formatProfileDate(profile.createdAt)}</p>
            ) : null}
        </article>
    )
}
