import type { Dispatch, SetStateAction } from "react"
import type { Socket } from "socket.io-client"
import type { CallProps } from "../../types"
import type { PlanLimitsWire } from "../../types/subscription"
import type { LastPreview } from "../socket/types"

export type CurrentChat = { name: string; id: number; isRoom: boolean; archived?: boolean } | null

export type SocketContextType = {
    socket: Socket | null
    token: string | null
    planSlug: string | null
    planLimits: PlanLimitsWire | null
    activeCall: CallProps | null
    myName: string | null
    myUserId: number | null
    onlineUserIds: Set<number>
    lastPreviews: Record<string, LastPreview>
    roomUnreadById: Record<number, number>
    dmUnreadByUsername: Record<string, number>
    setToken: (t: string | null) => void
    logout: () => void
    setActiveCall: Dispatch<SetStateAction<CallProps | null>>
    setMyName: (t: string | null) => void
    setMyUserId: (t: number | null) => void
    currentChat: CurrentChat
    setCurrentChat: (chat: CurrentChat) => void
}
