import { getLimitsForUser } from "../../../database/subscriptionPlans"
import { pool } from "../../../shared/deps"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { socketAck } from "../../../shared/types/socket/ack"
import { acceptedContactIds } from "./acceptedContacts"
import { hasAppearanceFields, parseProfileAppearance } from "./appearance"
import type { ProfileAppearancePatch } from "./appearance"
import type { ProfileUpdateAck, ProfileUpdatePayload } from "./contracts"

async function updateProfile(
    userId: number,
    status: string,
    bio: string,
    appearance: ProfileAppearancePatch
): Promise<void> {
    const appearanceColumns = [
        ["profile_avatar", appearance.avatar],
        ["profile_banner", appearance.profileBanner],
        ["profile_avatar_effect", appearance.profileAvatarEffect],
        ["profile_banner_effect", appearance.profileBannerEffect],
        ["profile_banner_sticker", appearance.profileBannerSticker]
    ] as const
    const assignments = ["profile_status = $1", "profile_bio = $2"]
    const values: Array<string | number | null> = [status, bio]
    for (const [column, value] of appearanceColumns) {
        if (value === undefined) continue
        values.push(value)
        assignments.push(`${column} = $${values.length}`)
    }
    values.push(userId)
    await pool.query(`UPDATE users SET ${assignments.join(", ")} WHERE id = $${values.length}`, values)
}

async function notifyProfileUpdated({ io, user }: FeatureContext): Promise<void> {
    try {
        const contacts = await acceptedContactIds(user.id)
        io.to([String(user.id), ...contacts.map(String)]).emit("profile:updated", {
            username: user.username,
            userId: user.id
        })
    } catch (error) {
        console.error("profile:updated", error)
    }
}

export function registerProfileUpdate(ctx: FeatureContext): void {
    const { socket, user } = ctx
    socket.on("profile:update", async (data: ProfileUpdatePayload, callback: unknown) => {
        const cb = socketAck<ProfileUpdateAck>(callback)
        if (!cb) return
        try {
            const status = typeof data?.status === "string" ? data.status.trim().slice(0, 120) : ""
            const bio = typeof data?.bio === "string" ? data.bio.trim().slice(0, 1000) : ""
            const payload = data || {}
            let appearance: ProfileAppearancePatch = {}
            if (hasAppearanceFields(payload)) {
                const { limits } = await getLimitsForUser(user.id, pool)
                const result = parseProfileAppearance(payload, limits)
                if ("err" in result) return cb({ success: false, err: result.err })
                appearance = result.patch
            }
            await updateProfile(user.id, status, bio, appearance)
            cb({ success: true })
            void notifyProfileUpdated(ctx)
        } catch (error) {
            console.error("profile:update", error)
            cb({ success: false, err: "Не удалось сохранить профиль" })
        }
    })
}
