import { act, renderHook } from "@testing-library/react"
import { useState } from "react"
import type { Socket } from "socket.io-client"
import type { UserProps } from "../../../types"
import { useMergedUserLists } from "./useMergedUserLists"
jest.mock("../../../features/chat/keyVault", () => ({ migrateRoomKeys: jest.fn(async () => {}) }))
jest.mock("../../../features/chat/roomE2ee", () => ({ clearRoomSymKeyFromStorage: jest.fn() }))

function fixture() {
    const handlers = new Map<string, () => void>()
    const callbacks = new Map<string, ((payload: unknown) => void)[]>()
    const socket = {
        emit: jest.fn((event: string, _data: unknown, callback: (payload: unknown) => void) => {
            callbacks.set(event, [...(callbacks.get(event) || []), callback])
        }),
        on: jest.fn((event: string, callback: () => void) => handlers.set(event, callback)),
        off: jest.fn()
    }
    return { socket: socket as unknown as Socket, handlers, callbacks }
}
const old: UserProps[] = [
    { id: 10, name: "SameName", is_room: false },
    { id: 5, name: "Existing room", is_room: true }
]
const friends = [{ id: 987, other_user_id: 10, friend_username: "SameName", status: "accepted" }]
beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test("busy ACKs preserve both lists and peer selection, then bounded retries accept real arrays", () => {
    const f = fixture()
    const { result } = renderHook(() => {
        const [users, setUsers] = useState(old)
        const state = useMergedUserLists(f.socket, setUsers, "me", 1)
        return { users, ...state }
    })
    act(() => {
        f.callbacks.get("friend:list")![0]({ err: "busy" })
        f.callbacks.get("room:list")![0]({ err: "busy" })
    })
    expect(result.current.users).toEqual(old)
    act(() => jest.advanceTimersByTime(250))
    act(() => {
        f.callbacks.get("friend:list")![1](friends)
        f.callbacks.get("room:list")![1]([{ id: 5, name: "Existing room" }])
    })
    expect(result.current.users.map((user) => user.id)).toEqual([5, 10])
    expect(result.current.listsLoading).toBe(false)
    act(() => {
        f.handlers.get("friend:list:updated")!()
        f.handlers.get("friend:list:updated")!()
        f.handlers.get("room:invite")!()
        jest.advanceTimersByTime(75)
    })
    expect(f.callbacks.get("friend:list")).toHaveLength(3)
    expect(f.callbacks.get("room:list")).toHaveLength(3)
})

test("socket changes discard old ACKs and unmount cancels pending busy retries", () => {
    const first = fixture(),
        second = fixture()
    const { result, rerender, unmount } = renderHook(
        ({ socket }) => {
            const [users, setUsers] = useState(old)
            useMergedUserLists(socket, setUsers, "me", 1)
            return users
        },
        { initialProps: { socket: first.socket } }
    )
    rerender({ socket: second.socket })
    act(() => {
        first.callbacks.get("friend:list")![0]([{ ...friends[0], other_user_id: 99 }])
        first.callbacks.get("room:list")![0]([])
        second.callbacks.get("friend:list")![0]({ err: "busy" })
        second.callbacks.get("room:list")![0]({ err: "busy" })
    })
    expect(result.current).toEqual(old)
    unmount()
    act(() => jest.advanceTimersByTime(20_000))
    expect(second.callbacks.get("friend:list")).toHaveLength(1)
})
