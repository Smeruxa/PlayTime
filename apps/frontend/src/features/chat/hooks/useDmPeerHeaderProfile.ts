import { useEffect, useLayoutEffect, useState } from "react"
import type { Socket } from "socket.io-client"
import type { UserPublicProfile } from "../../../types"
import { subscribeProfileUpdates } from "../../../profile/profileUpdates"

export type DmChatHeaderVisual = {
    avatar: string | null
    profileAvatarEffect: string
    profileBanner: string | null
    profileBannerEffect: string
    profileBannerSticker: string
}

const profileSnapByPeer = new Map<string, DmChatHeaderVisual>()
const SS_PREFIX = "playtime:dmHeaderSnap:v2:"

function readPersistedSnap(peer: string): DmChatHeaderVisual | null {
    try {
        const raw = sessionStorage.getItem(SS_PREFIX + peer)
        if (!raw) return null
        const o = JSON.parse(raw) as Partial<DmChatHeaderVisual>
        if (typeof o.profileAvatarEffect !== "string" || typeof o.profileBannerEffect !== "string") return null
        return {
            avatar: typeof o.avatar === "string" || o.avatar === null ? o.avatar : null,
            profileAvatarEffect: o.profileAvatarEffect,
            profileBanner: typeof o.profileBanner === "string" || o.profileBanner === null ? o.profileBanner : null,
            profileBannerEffect: o.profileBannerEffect,
            profileBannerSticker: o.profileBannerSticker ?? "none"
        }
    } catch {
        return null
    }
}

function writePersistedSnap(peer: string, snap: DmChatHeaderVisual) {
    try {
        sessionStorage.setItem(SS_PREFIX + peer, JSON.stringify(snap))
    } catch {
    }
}

function snapFromProfile(p: UserPublicProfile): DmChatHeaderVisual {
    return {
        avatar: p.avatar,
        profileAvatarEffect: p.profileAvatarEffect ?? "none",
        profileBanner: p.profileBanner ?? null,
        profileBannerEffect: p.profileBannerEffect ?? "none",
        profileBannerSticker: p.profileBannerSticker ?? "none"
    }
}

export function useDmPeerHeaderProfile(
    socket: Socket | null,
    peerUsername: string,
    enabled: boolean,
    peerUserId?: number,
    myUserId?: number | null
) {
    const cacheKey = `${myUserId}:dm:${peerUserId}`
    const eligible = enabled && myUserId != null && peerUserId != null
    const [snap, setSnap] = useState<DmChatHeaderVisual | null>(() => {
        if (!eligible || !peerUsername) return null
        return profileSnapByPeer.get(cacheKey) ?? readPersistedSnap(cacheKey)
    })

    useLayoutEffect(() => {
        if (!eligible || !peerUsername) {
            setSnap(null)
            return
        }
        setSnap(profileSnapByPeer.get(cacheKey) ?? readPersistedSnap(cacheKey))
    }, [eligible, peerUsername, cacheKey])

    useEffect(() => {
        if (!eligible || !socket || !peerUsername) {
            return
        }

        let cancelled = false
        let generation = 0
        const refresh = () => {
            const request = ++generation
            socket.emit(
                "profile:get",
                { username: peerUsername, peerUserId },
                (res: { profile?: UserPublicProfile; err?: string }) => {
                    if (cancelled || request !== generation) return
                    if (res.err || !res.profile || res.profile.userId !== peerUserId) return
                    const next = snapFromProfile(res.profile)
                    profileSnapByPeer.set(cacheKey, next)
                    writePersistedSnap(cacheKey, next)
                    setSnap(next)
                }
            )
        }
        const unsubscribe = subscribeProfileUpdates(socket, refresh, peerUsername)
        refresh()

        return () => {
            cancelled = true
            unsubscribe()
        }
    }, [socket, peerUsername, eligible, peerUserId, cacheKey])

    return snap
}
