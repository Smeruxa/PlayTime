import { createContext } from "react"
import type { SocketContextType } from "./types"

export const socketContextDefaultValue: SocketContextType = {
    socket: null,
    token: null,
    planSlug: null,
    planLimits: null,
    activeCall: null,
    myName: null,
    myUserId: null,
    onlineUserIds: new Set(),
    lastPreviews: {},
    roomUnreadById: {},
    dmUnreadByUsername: {},
    setToken: () => {},
    logout: () => {},
    setActiveCall: () => {},
    setMyName: () => {},
    setMyUserId: () => {},
    currentChat: null,
    setCurrentChat: () => {}
}

export const SocketContext = createContext<SocketContextType>(socketContextDefaultValue)

export type SessionContextType = Omit<
    SocketContextType,
    "activeCall" | "setActiveCall" | "onlineUserIds" | "lastPreviews" | "roomUnreadById" | "dmUnreadByUsername"
>
export const SessionContext = createContext<SessionContextType>(socketContextDefaultValue)
export const CallContext =
    createContext<Pick<SocketContextType, "activeCall" | "setActiveCall">>(socketContextDefaultValue)
export const PresenceContext = createContext(socketContextDefaultValue.onlineUserIds)
export const ChatPreviewsContext =
    createContext<Pick<SocketContextType, "lastPreviews" | "roomUnreadById" | "dmUnreadByUsername">>(
        socketContextDefaultValue
    )
