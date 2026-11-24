import { resolveAuthedUser, type FeatureRemoteSocket } from "./featureContext"

export interface PartyParticipantRef {
    userId: number
    username: string
}

export function partyParticipantFromFetched(fetched: FeatureRemoteSocket): PartyParticipantRef | null {
    const u = resolveAuthedUser(fetched)
    if (!u) return null
    return { userId: u.id, username: u.username }
}
