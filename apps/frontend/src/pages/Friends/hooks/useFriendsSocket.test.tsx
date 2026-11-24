import { act, renderHook } from "@testing-library/react"
import type { Socket } from "socket.io-client"
import { useFriendsSocket } from "./useFriendsSocket"

test("busy friend and outgoing ACKs keep valid identities and retry without duplicate refresh fanout", () => {
    jest.useFakeTimers()
    const callbacks = new Map<string, ((data: unknown) => void)[]>()
    const handlers = new Map<string, () => void>()
    const socket = {
        emit: jest.fn((event: string, _data: unknown, callback: (data: unknown) => void) =>
            callbacks.set(event, [...(callbacks.get(event) || []), callback])
        ),
        on: jest.fn((event: string, callback: () => void) => handlers.set(event, callback)),
        off: jest.fn()
    }
    const { result, unmount } = renderHook(() => useFriendsSocket(socket as unknown as Socket, undefined, 1))
    act(() => {
        callbacks.get("friend:list")![0]([
            { id: 999, other_user_id: 10, friend_username: "SameName", status: "accepted" }
        ])
        callbacks.get("friend:outgoingIdentities")![0]([{ userId: 20, username: "SameName" }])
        handlers.get("friend:list:updated")!()
        handlers.get("friend:list:updated")!()
        jest.advanceTimersByTime(75)
    })
    expect(callbacks.get("friend:list")).toHaveLength(2)
    act(() => {
        callbacks.get("friend:list")![1]({ err: "busy" })
        callbacks.get("friend:outgoingIdentities")![1]({ err: "busy" })
    })
    expect(result.current.friends[0].other_user_id).toBe(10)
    expect(result.current.outgoingRequests[0].userId).toBe(20)
    act(() => jest.advanceTimersByTime(250))
    act(() => {
        callbacks.get("friend:list")![2]([])
        callbacks.get("friend:outgoingIdentities")![2]([])
    })
    expect(result.current.friends).toEqual([])
    expect(result.current.outgoingRequests).toEqual([])
    unmount()
    jest.useRealTimers()
})
