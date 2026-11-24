import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { createArrayRefresh } from "../../../server/socket/arrayRefresh"
import type { Socket } from "socket.io-client"
import type { UserProps } from "../../../types"
import { friendPeerId, type FriendItem } from "../../Friends/types"
import { clearRoomSymKeyFromStorage } from "../../../features/chat/roomE2ee"
import { migrateRoomKeys } from "../../../features/chat/keyVault"

type SetUsers = Dispatch<SetStateAction<UserProps[]>>

type RoomListRow = { id: number; name: string; created_by?: number }

function parseRoomId(data: { roomId?: unknown } | null | undefined): number | null {
    const n = Number(data?.roomId)
    return Number.isFinite(n) ? n : null
}

export function useMergedUserLists(
    socket: Socket | null,
    setUsers: SetUsers,
    myName: string | null,
    myUserId: number | null = null
) {
    const [listsLoading, setListsLoading] = useState(!!socket)

    useEffect(() => {
        if (!socket) {
            setListsLoading(false)
            return
        }

        const loadingFailsafe = window.setTimeout(() => {
            setListsLoading(false)
        }, 18_000)

        let friendsList: UserProps[] | null = null
        let roomsList: UserProps[] | null = null
        const merge = () => {
            if (!friendsList || !roomsList) return
            setUsers([...roomsList, ...friendsList])
            setListsLoading(false)
        }
        const failed = () => setListsLoading(false)
        const friendsRefresh = createArrayRefresh<FriendItem>(
            (callback) => socket.emit("friend:list", null, callback),
            (rows) => {
                friendsList = rows
                    .filter((row) => row && row.status === "accepted" && !row.is_room)
                    .flatMap((row) => {
                        const id = friendPeerId(row, myUserId)
                        return id == null
                            ? []
                            : [
                                  {
                                      name: row.friend_username,
                                      id,
                                      is_room: false,
                                      archived: row.friend_archived === true
                                  }
                              ]
                    })
                merge()
            },
            failed
        )
        const roomsRefresh = createArrayRefresh<RoomListRow>(
            (callback) => socket.emit("room:list", null, callback),
            (rows) => {
                const valid = rows.filter((row) => row && Number.isSafeInteger(row.id) && typeof row.name === "string")
                void migrateRoomKeys(valid.map((room) => room.id)).catch(() =>
                    console.warn("Не удалось перенести ключи комнат в системное хранилище")
                )
                roomsList = valid.map((room) => ({
                    name: room.name,
                    id: room.id,
                    is_room: true,
                    roomCreatedBy: room.created_by
                }))
                merge()
            },
            failed
        )
        const startRefetch = (showLoading: boolean) => {
            if (showLoading) setListsLoading(true)
            friendsRefresh.refresh(showLoading)
            roomsRefresh.refresh(showLoading)
        }
        startRefetch(true)

        const friendDeletes = () => startRefetch(false)
        const roomRenamed = (data: { roomId: number; name: string }) => {
            const rid = parseRoomId(data)
            if (rid == null) return
            setUsers((prev) => prev.map((u) => (u.is_room && u.id === rid ? { ...u, name: data.name } : u)))
        }
        const roomInvite = () => startRefetch(false)
        const roomRemoved = (data: { roomId: number }) => {
            const rid = parseRoomId(data)
            if (rid == null) return
            clearRoomSymKeyFromStorage(rid)
            setUsers((prev) => prev.filter((u) => !u.is_room || u.id !== rid))
            startRefetch(false)
        }

        const onFriendListUpdated = () => startRefetch(false)

        const refreshVisible = () => {
            if (document.visibilityState === "visible") startRefetch(false)
        }
        socket.on("connect", onFriendListUpdated)
        window.addEventListener("focus", refreshVisible)
        document.addEventListener("visibilitychange", refreshVisible)
        socket.on("friend:remove", friendDeletes)
        socket.on("room:renamed", roomRenamed)
        socket.on("room:invite", roomInvite)
        socket.on("room:removed", roomRemoved)
        socket.on("friend:list:updated", onFriendListUpdated)
        return () => {
            friendsRefresh.dispose()
            roomsRefresh.dispose()
            window.clearTimeout(loadingFailsafe)
            socket.off("connect", onFriendListUpdated)
            window.removeEventListener("focus", refreshVisible)
            document.removeEventListener("visibilitychange", refreshVisible)
            socket.off("friend:remove", friendDeletes)
            socket.off("room:renamed", roomRenamed)
            socket.off("room:invite", roomInvite)
            socket.off("room:removed", roomRemoved)
            socket.off("friend:list:updated", onFriendListUpdated)
        }
    }, [socket, myName, myUserId, setUsers])

    return { listsLoading }
}
