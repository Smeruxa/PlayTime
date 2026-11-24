import { useCallback, useState } from "react"
import type { UserProps } from "../../../types"

type Selection = Pick<UserProps, "id" | "is_room">

export function useSelectedConversation(users: UserProps[]) {
    const [choice, setChoice] = useState<Selection | null>(null)
    const [navigation, setNavigation] = useState(-1)
    const currentUser = choice
        ? users.findIndex((user) => user.id === choice.id && user.is_room === choice.is_room)
        : -1
    const selected = navigation < 0 ? navigation : currentUser
    const setUser = useCallback(
        (index: number) => {
            const user = users[index]
            setChoice(user ? { id: user.id, is_room: user.is_room } : null)
        },
        [users]
    )
    return { currentUser, selected, setUser, setSelected: setNavigation, selectIdentity: setChoice }
}
