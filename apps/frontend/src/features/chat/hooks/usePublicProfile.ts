import { useCallback, useEffect, useState } from "react"
import { useSessionSocket } from "../../../server/socketContext"
import type { UserPublicProfile } from "../../../types"
import { subscribeProfileUpdates } from "../../../profile/profileUpdates"

export function usePublicProfile(username: string | null, peerUserId?: number) {
    const { socket, myUserId } = useSessionSocket()
    const identity = `${myUserId}:${peerUserId ?? username}`
    const [profileState, setProfileState] = useState<{ identity: string; profile: UserPublicProfile | null }>({
        identity,
        profile: null
    })
    const profile = profileState.identity === identity ? profileState.profile : null
    const setProfile = useCallback(
        (value: UserPublicProfile | null) => setProfileState({ identity, profile: value }),
        [identity]
    )
    const [err, setErr] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!socket || !username) {
            setProfile(null)
            setErr(null)
            setLoading(false)
            return
        }
        setLoading(true)
        setProfile(null)
        setErr(null)
        let cancelled = false
        let generation = 0
        const refresh = () => {
            const request = ++generation
            socket.emit(
                "profile:get",
                { username, peerUserId },
                (res: { profile?: UserPublicProfile; err?: string }) => {
                    if (cancelled || request !== generation) return
                    setLoading(false)
                    setErr(res.err ?? null)
                    setProfile(
                        res.profile && (peerUserId === undefined || res.profile.userId === peerUserId)
                            ? res.profile
                            : null
                    )
                }
            )
        }
        const unsubscribe = subscribeProfileUpdates(socket, refresh, username)
        refresh()
        return () => {
            cancelled = true
            unsubscribe()
        }
    }, [socket, username, peerUserId, myUserId, identity, setProfile])

    return {
        profile,
        err: profileState.identity === identity ? err : null,
        loading: profileState.identity === identity ? loading : true
    }
}
