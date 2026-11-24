import { useState, useEffect } from "react"
import type { PartyParticipant } from "../types"

export function usePartyParticipants(socket: any, isParty: boolean) {
    const [participants, setParticipants] = useState<PartyParticipant[]>([])
    const [listReady, setListReady] = useState(!isParty)

    useEffect(() => {
        if (!isParty || !socket) {
            setListReady(true)
            return
        }
        setListReady(false)
        setParticipants([])
        const onList = (list: PartyParticipant[]) => {
            setParticipants(list)
            setListReady(true)
        }
        const onJoined = (p: PartyParticipant) =>
            setParticipants((prev) => (prev.some((x) => x.userId === p.userId) ? prev : [...prev, p]))
        const onLeft = (p: PartyParticipant) => setParticipants((prev) => prev.filter((x) => x.userId !== p.userId))
        socket.on("party:participants:list", onList)
        socket.on("party:participant:joined", onJoined)
        socket.on("party:participant:left", onLeft)
        return () => {
            socket.off("party:participants:list", onList)
            socket.off("party:participant:joined", onJoined)
            socket.off("party:participant:left", onLeft)
        }
    }, [isParty, socket])

    return { participants, listReady }
}
