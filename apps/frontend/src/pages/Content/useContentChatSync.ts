import { useEffect } from "react"
import type { UserProps } from "../../types"
import { useSessionSocket } from "../../server/socketContext"

export function useContentChatSync(currentUser: number, user: UserProps | undefined) {
    const { setCurrentChat } = useSessionSocket()
    const name = user?.name
    const id = user?.id
    const isRoom = user?.is_room
    const archived = user?.archived

    useEffect(() => {
        if (currentUser >= 0 && name !== undefined && id !== undefined && isRoom !== undefined)
            setCurrentChat({ name, id, isRoom, archived })
        else setCurrentChat(null)
        return () => setCurrentChat(null)
    }, [currentUser, name, id, isRoom, archived, setCurrentChat])
}
