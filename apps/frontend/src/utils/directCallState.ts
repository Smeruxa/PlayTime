import type { CallProps } from "../types"

export type DirectCallState = {
    roomId: string
    status: "request_receiver" | "in_call"
    revision: number
    caller: { id: number; username: string; ownershipRevision?: number }
    receiver: { id: number; username: string; ownershipRevision?: number }
    media?: { active: boolean; canClaim: boolean; ownershipRevision: number }
    expiresAt?: number
}

export function validCallMedia(state: DirectCallState): boolean {
    if (state.media === undefined) return true
    const media = state.media
    return (
        !!media &&
        typeof media.active === "boolean" &&
        typeof media.canClaim === "boolean" &&
        Number.isSafeInteger(media.ownershipRevision) &&
        media.ownershipRevision >= 0 &&
        (!media.active || media.ownershipRevision > 0)
    )
}

export function callFromState(state: DirectCallState, userId: number): CallProps | null {
    if (!state || typeof state.roomId !== "string" || !state.caller || !state.receiver) return null
    if (state.caller.id !== userId && state.receiver.id !== userId) return null
    if (!validCallMedia(state)) return null
    if (state.media && !state.media.active) return null
    return {
        names: [state.caller.username, state.receiver.username],
        participantIds: [state.caller.id, state.receiver.id],
        roomId: state.roomId,
        incoming: state.receiver.id === userId,
        confirmed: state.status === "in_call",
        revision: state.revision,
        ownershipRevision: state.media?.ownershipRevision,
        peerOwnershipRevision: (state.caller.id === userId ? state.receiver : state.caller).ownershipRevision
    }
}

export function resolveDirectCallResponse(
    state: DirectCallState | null | undefined,
    userId: number,
    legacyCall: CallProps
): CallProps | null {
    if (state === undefined) return legacyCall
    return state ? callFromState(state, userId) : null
}

export function mergeDirectCall(previous: CallProps | null, next: CallProps): CallProps {
    if (previous && !previous.isParty && previous.roomId === next.roomId) {
        if ((previous.revision ?? 0) > (next.revision ?? 0) || (previous.confirmed && !next.confirmed)) return previous
        if (
            previous.revision === next.revision &&
            previous.confirmed === next.confirmed &&
            previous.ownershipRevision === next.ownershipRevision &&
            previous.peerOwnershipRevision === next.peerOwnershipRevision
        )
            return previous
    }
    return next
}
