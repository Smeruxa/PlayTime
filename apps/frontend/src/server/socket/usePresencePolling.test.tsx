import { act, renderHook } from "@testing-library/react"
import { useState } from "react"
import type { Socket } from "socket.io-client"
import { usePresencePolling } from "./usePresencePolling"

test("presence snapshots and deltas address accounts with reused names independently", () => {
    const handlers = new Map<string, (data?: unknown) => void>()
    const socket = {
        connected: true,
        emit: jest.fn((event: string, callback: (ids: number[]) => void) => {
            if (event === "presence:listByUserId") callback([20])
        }),
        on: jest.fn((event: string, handler: (data?: unknown) => void) => handlers.set(event, handler)),
        off: jest.fn()
    }
    const { result } = renderHook(() => {
        const [ids, setIds] = useState(new Set<number>())
        usePresencePolling(socket as unknown as Socket, setIds)
        return ids
    })
    expect(result.current.has(10)).toBe(false)
    expect(result.current.has(20)).toBe(true)
    act(() => handlers.get("presence:changed")?.({ userId: 10, online: true }))
    expect(result.current).toEqual(new Set([10, 20]))
    act(() => handlers.get("presence:changed")?.({ userId: 20, online: false }))
    expect(result.current).toEqual(new Set([10]))
    act(() => handlers.get("disconnect")?.())
    expect(result.current.size).toBe(0)
})
