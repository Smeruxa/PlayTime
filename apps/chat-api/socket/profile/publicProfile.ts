import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool } from "../../../shared/deps"
import type { RowProfileUser } from "../../../shared/types/db"
import { socketAck } from "../../../shared/types/socket/ack"
import { isBannerStickerId } from "../../../shared/subscription/bannerStickers"
import { visibleAvatarEffect, visibleBannerEffect } from "../../../shared/subscription/profileCustomization"
import { getLimitsForUser } from "../../../database/subscriptionPlans"
import { normalizeUsername } from "../messages/helpers"
import { resolvePeer } from "../peerIdentity"
import { areFriends } from "./acceptedContacts"
import type { ProfileGetAck, ProfileGetPayload } from "./contracts"

export function registerPublicProfile({ socket, user }: FeatureContext): void {
    const uid = user.id

    socket.on("profile:get", async (data: ProfileGetPayload, callback: unknown) => {
        const cb = socketAck<ProfileGetAck>(callback)
        if (!cb) return
        try {
            const requestedUsername = normalizeUsername(data?.username)
            let peerUserId = data?.peerUserId
            if (peerUserId === undefined && !requestedUsername) peerUserId = uid
            const peer = await resolvePeer(peerUserId, requestedUsername, { allowArchived: true })
            if (!peer) return cb({ err: "Пользователь не найден" })
            const row = await pool.query<RowProfileUser>(
                `SELECT id, username, email, is_guest, guest_registration_pending, profile_status, profile_bio, profile_avatar, profile_banner, profile_avatar_effect, profile_banner_effect, profile_banner_sticker, created_at, dm_public_key
                 FROM users WHERE id = $1`,
                [peer.id]
            )
            if (row.rows.length === 0) return cb({ err: "Пользователь не найден" })
            const u = row.rows[0]
            const isSelf = u.id === uid
            if (!isSelf && !(await areFriends(uid, u.id))) return cb({ err: "Профиль доступен только друзьям" })
            const { limits: ownerLimits } = await getLimitsForUser(u.id, pool)
            const profileBanner = ownerLimits.profileBannerAllowed ? u.profile_banner || null : null
            const profileAvatarEffect = visibleAvatarEffect(ownerLimits, u.profile_avatar_effect)
            const profileBannerEffect = visibleBannerEffect(ownerLimits, u.profile_banner_effect)
            const rawSticker = u.profile_banner_sticker || "none"
            const profileBannerSticker =
                ownerLimits.profileBannerAllowed &&
                ownerLimits.profileBannerEffectsAllowed &&
                isBannerStickerId(rawSticker)
                    ? rawSticker
                    : "none"
            cb({
                profile: {
                    username: peer.username,
                    userId: u.id,
                    archived: Boolean(peer.guest_archived_at),
                    email: isSelf && (!u.is_guest || u.guest_registration_pending) ? u.email : undefined,
                    ...(isSelf
                        ? { isGuest: u.is_guest === true, registrationPending: u.guest_registration_pending === true }
                        : {}),
                    status: u.profile_status || "",
                    bio: u.profile_bio || "",
                    avatar: u.profile_avatar || null,
                    profileBanner,
                    profileAvatarEffect,
                    profileBannerEffect,
                    profileBannerSticker,
                    createdAt: u.created_at,
                    isSelf,
                    ...(isSelf ? { dmPublicKey: u.dm_public_key ?? null } : {})
                }
            })
        } catch (e) {
            console.error("profile:get", e)
            cb({ err: "Ошибка загрузки профиля" })
        }
    })
}
