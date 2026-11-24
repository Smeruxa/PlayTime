import { useLocation, useNavigate } from "react-router-dom"
import { useState, useEffect, useCallback, useRef } from "react"
import type { UserProps } from "../../types"
import type { FriendsAvatarsMap } from "../../types/friendAvatar"
import { useSessionSocket, useCallState } from "../../server/socketContext"
import { useSelectedConversation } from "./hooks/useSelectedConversation"
import { useMergedUserLists } from "./hooks/useMergedUserLists"
import { MainLayoutShell } from "./MainLayoutShell"
import type { MainLayoutContext } from "./mainLayoutTypes"
import { subscribeProfileUpdates } from "../../profile/profileUpdates"

export default function MainLayoutPage() {
    const location = useLocation()
    const navigate = useNavigate()
    const { socket, logout, myName, myUserId } = useSessionSocket()
    const { activeCall, setActiveCall } = useCallState()

    const [users, setUsers] = useState<UserProps[]>([])
    const { currentUser, selected, setUser, setSelected, selectIdentity } = useSelectedConversation(users)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [avatarByUsername, setAvatarByUsername] = useState<FriendsAvatarsMap>({})
    const selectedCallRef = useRef<string | number | null>(null)

    const loadFriendAvatars = useCallback(() => {
        if (!socket) return
        socket.emit("profile:friendsAvatars", { byUserId: true }, (map: FriendsAvatarsMap | undefined) => {
            if (map && typeof map === "object") setAvatarByUsername(map)
        })
    }, [socket])

    useEffect(() => {
        if (!socket) return
        loadFriendAvatars()
        const bump = () => loadFriendAvatars()
        socket.on("friend:list:updated", bump)
        socket.on("friend:remove", bump)
        const unsubscribe = subscribeProfileUpdates(socket, bump)
        return () => {
            socket.off("friend:list:updated", bump)
            socket.off("friend:remove", bump)
            unsubscribe()
        }
    }, [socket, loadFriendAvatars])

    useEffect(() => {
        if (!socket) return
        loadFriendAvatars()
    }, [location.pathname, socket, loadFriendAvatars])

    useEffect(() => {
        if (!activeCall) {
            selectedCallRef.current = null
            return
        }
        if (!myName) return
        const name = activeCall.isParty
            ? activeCall.names[0]
            : activeCall.names.find((participant) => participant && participant !== myName)
        if (!name) return
        if (selectedCallRef.current !== activeCall.roomId) {
            const peerId = activeCall.participantIds?.find((id) => id !== myUserId)
            const idx = users.findIndex(
                (user) =>
                    user.is_room === !!activeCall.isParty &&
                    (peerId !== undefined && !activeCall.isParty ? user.id === peerId : user.name === name)
            )
            if (idx !== -1) {
                selectedCallRef.current = activeCall.roomId
                setSelected(idx)
                setUser(idx)
            }
        }
    }, [activeCall, myName, users, myUserId, setSelected, setUser])

    useEffect(() => {
        if (!location.state || !myName) return
        const state = location.state as {
            call?: { name?: string; peerUserId?: number }
            name?: string
            peerUserId?: number
            openRoom?: { id: number; name: string }
        }
        const name = state.call?.name ?? state.name
        const openRoom = state.openRoom
        const peerUserId = state.call?.peerUserId ?? state.peerUserId
        let idx = -1
        if (openRoom) {
            idx = users.findIndex((user) => user.is_room && user.id === openRoom.id)
            if (idx === -1) idx = users.length
            setUsers((prev) => {
                const exists = prev.some((u) => u.is_room && u.id === openRoom.id)
                if (exists) return prev
                return [
                    ...prev,
                    {
                        name: openRoom.name,
                        id: openRoom.id,
                        is_room: true,
                        roomCreatedBy: myUserId ?? undefined
                    }
                ]
            })
        } else if (peerUserId !== undefined) {
            idx = users.findIndex((user) => !user.is_room && user.id === peerUserId)
        } else if (name) {
            const matches = users.filter((user) => !user.is_room && user.name === name)
            if (matches.length === 1) idx = users.indexOf(matches[0])
        }
        if (idx === -1) return
        setSelected(idx)
        if (openRoom) selectIdentity({ id: openRoom.id, is_room: true })
        else setUser(idx)
        const remainingState = { ...state }
        delete remainingState.call
        delete remainingState.name
        delete remainingState.peerUserId
        delete remainingState.openRoom
        navigate(`${location.pathname}${location.search}${location.hash}`, {
            replace: true,
            state: Object.keys(remainingState).length ? remainingState : null
        })
    }, [location, users, myName, myUserId, navigate, selectIdentity, setSelected, setUser])

    const { listsLoading } = useMergedUserLists(socket, setUsers, myName, myUserId)

    const updateRoomName = (roomId: number, newName: string) => {
        setUsers((prev) => prev.map((u) => (u.is_room && u.id === roomId ? { ...u, name: newName } : u)))
    }

    const context: MainLayoutContext = {
        users,
        currentUser,
        setUser,
        selected,
        setSelected,
        updateRoomName
    }

    return (
        <MainLayoutShell
            settingsOpen={settingsOpen}
            users={users}
            selected={selected}
            avatarByUsername={avatarByUsername}
            listsLoading={listsLoading}
            activeCall={activeCall}
            context={context}
            onCloseSettings={() => setSettingsOpen(false)}
            onOpenSettings={() => setSettingsOpen(true)}
            onLogout={logout}
            setUser={setUser}
            setSelected={setSelected}
            setActiveCall={setActiveCall}
        />
    )
}
