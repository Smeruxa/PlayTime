import type { UserProps } from "../../types"

export type MainLayoutContext = {
    users: UserProps[]
    currentUser: number
    setUser: (index: number) => void
    selected: number
    setSelected: (index: number) => void
    updateRoomName: (roomId: number, newName: string) => void
}
