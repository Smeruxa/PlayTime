import { useEffect, useMemo, useSyncExternalStore } from "react"
import type { Socket } from "socket.io-client"
import { getMessageOutbox, mergeOutgoingMessages, type OutgoingMessage } from "../../messageOutbox"
import type { DisplayMessage } from "../../types"

const empty: readonly OutgoingMessage[] = []
const emptySnapshot = () => empty
const emptySubscription = () => () => {}

export function useOutgoingMessages(
    socket: Socket | null,
    userId: number | null,
    chatKey: string,
    stored: DisplayMessage[]
) {
    const outbox = useMemo(() => (socket && userId != null ? getMessageOutbox(socket, userId) : null), [socket, userId])
    const outgoing = useSyncExternalStore(
        outbox?.subscribe ?? emptySubscription,
        outbox?.getSnapshot ?? emptySnapshot,
        emptySnapshot
    )
    useEffect(() => {
        outbox?.retireStored(new Set(stored.map((message) => message.id)))
    }, [outbox, stored])
    const chatMessages = useMemo(() => mergeOutgoingMessages(stored, outgoing, chatKey), [stored, outgoing, chatKey])
    return { outbox, chatMessages }
}
