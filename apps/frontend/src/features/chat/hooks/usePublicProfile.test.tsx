import { act, renderHook } from "@testing-library/react"
import type { UserPublicProfile } from "../../../types"
import { usePublicProfile } from "./usePublicProfile"
import { useDmPeerHeaderProfile } from "./useDmPeerHeaderProfile"
import { useSessionSocket } from "../../../server/socketContext"
import type { Socket } from "socket.io-client"

jest.mock("../../../server/socketContext", () => ({ useSessionSocket: jest.fn() }))
const profile = (userId: number) => ({ userId, username: "SameName", avatar: `avatar-${userId}` }) as UserPublicProfile

test("public profiles reject a different account and callbacks from an old peer", () => {
    const callbacks: ((reply: { profile: UserPublicProfile }) => void)[] = []
    const socket = { emit: jest.fn((_event, _data, callback) => callbacks.push(callback)), on: jest.fn(), off: jest.fn() }
    ;(useSessionSocket as jest.Mock).mockReturnValue({ socket, myUserId: 1 })
    const { result, rerender } = renderHook(({ id }) => usePublicProfile("SameName", id), { initialProps: { id: 10 } })
    act(() => callbacks[0]({ profile: profile(20) }))
    expect(result.current.profile).toBeNull()
    rerender({ id: 20 })
    act(() => callbacks[0]({ profile: profile(10) }))
    expect(result.current.profile).toBeNull()
    act(() => callbacks[1]({ profile: profile(20) }))
    expect(result.current.profile?.userId).toBe(20)
})

test("header profile caches are separated by both participants and ignore foreign IDs", () => {
    const callbacks: ((reply: { profile: UserPublicProfile }) => void)[] = []
    const socket = { emit: jest.fn((_event, _data, callback) => callbacks.push(callback)), on: jest.fn(), off: jest.fn() } as unknown as Socket
    const { result, rerender } = renderHook(({ id, self }) => useDmPeerHeaderProfile(socket, "SameName", true, id, self), { initialProps: { id: 10, self: 1 } })
    act(() => callbacks[0]({ profile: profile(20) }))
    expect(result.current).toBeNull()
    act(() => callbacks[0]({ profile: profile(10) }))
    expect(result.current?.avatar).toBe("avatar-10")
    rerender({ id: 20, self: 1 })
    expect(result.current).toBeNull()
    act(() => callbacks[1]({ profile: profile(20) }))
    expect(result.current?.avatar).toBe("avatar-20")
    rerender({ id: 20, self: 2 })
    expect(result.current).toBeNull()
})
