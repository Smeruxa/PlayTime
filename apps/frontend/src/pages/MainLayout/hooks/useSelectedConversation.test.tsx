import { act, renderHook } from "@testing-library/react"
import { useSelectedConversation } from "./useSelectedConversation"
import type { UserProps } from "../../../types"

test("reordering and nickname reuse cannot change the selected account", () => {
    const old: UserProps = { id: 10, name: "moon", is_room: false, archived: true }
    const replacement: UserProps = { id: 20, name: "moon", is_room: false }
    const { result, rerender } = renderHook(({ users }) => useSelectedConversation(users), {
        initialProps: { users: [old, replacement] }
    })
    act(() => {
        result.current.setUser(0)
        result.current.setSelected(0)
    })
    rerender({ users: [replacement, old] })
    expect(result.current.currentUser).toBe(1)
    expect(result.current.selected).toBe(1)
    rerender({ users: [replacement] })
    expect(result.current.currentUser).toBe(-1)
    expect(result.current.selected).toBe(-1)
})

test("a room and an account sharing an integer ID remain distinct", () => {
    const users: UserProps[] = [
        { id: 10, name: "room", is_room: true },
        { id: 10, name: "moon", is_room: false }
    ]
    const { result } = renderHook(() => useSelectedConversation(users))
    act(() => result.current.setUser(1))
    expect(result.current.currentUser).toBe(1)
})
