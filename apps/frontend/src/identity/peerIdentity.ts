export type DirectMessageIdentity = {
    sender_id?: number
    receiver_id?: number
    sender_username?: string
    receiver_username?: string
}

export function matchesDirectMessage(
    message: DirectMessageIdentity,
    peerId: number,
    selfId: number | null,
    peerName: string,
    selfName: string | null
): boolean {
    if (message.sender_id !== undefined || message.receiver_id !== undefined) {
        return (
            selfId !== null &&
            ((message.sender_id === peerId && message.receiver_id === selfId) ||
                (message.sender_id === selfId && message.receiver_id === peerId))
        )
    }
    return (
        (message.sender_username === peerName && message.receiver_username === selfName) ||
        (message.sender_username === selfName && message.receiver_username === peerName)
    )
}

export function matchesPeer(
    peerUserId: number | undefined,
    expectedId: number,
    legacyName: string | undefined,
    expectedName: string
): boolean {
    return peerUserId !== undefined ? peerUserId === expectedId : legacyName === expectedName
}
