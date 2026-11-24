import { useContext } from "react"
import { SocketContext, SessionContext, CallContext, PresenceContext, ChatPreviewsContext } from "./context"

export function useSocket() {
    return useContext(SocketContext)
}

export function useSessionSocket() {
    return useContext(SessionContext)
}
export function useCallState() {
    return useContext(CallContext)
}
export function useOnlineUserIds() {
    return useContext(PresenceContext)
}
export const useOnlineUsers = useOnlineUserIds
export function useChatPreviews() {
    return useContext(ChatPreviewsContext)
}
