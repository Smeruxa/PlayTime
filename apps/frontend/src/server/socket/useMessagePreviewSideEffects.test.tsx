import { act, renderHook } from "@testing-library/react"
import { useRef, useState } from "react"
import type { Socket } from "socket.io-client"
import type { LastPreview } from "./types"
import { useMessagePreviewSideEffects } from "./useMessagePreviewSideEffects"
import { isPeerNotifyMuted } from "../../notificationPrefs"
import { notifyMessage } from "../../platform/notifications"

jest.mock("../../features/chat/dmE2ee", () => ({ DM_E2EE_PREFIX: "DM:", getDmSecretKey: jest.fn() }))
jest.mock("../../features/chat/roomE2ee", () => ({ ROOM_E2EE_PREFIX: "ROOM:", loadRoomSymKeyFromStorage: jest.fn() }))
jest.mock("../../features/chat/mediaEncryption", () => ({
    MEDIA_MESSAGE_PREFIX: "MEDIA:",
    decodeMediaMessage: jest.fn()
}))
jest.mock("../../platform/notifications", () => ({ notifyMessage: jest.fn() }))
jest.mock("../../notificationPrefs", () => ({ isPeerNotifyMuted: jest.fn(() => false) }))

test("a new owner of the same nickname does not update the archived conversation or suppress its notification", () => {
    const handlers = new Map<string, (data: unknown) => void>()
    const socket = {
        on: jest.fn((event: string, handler: (data: unknown) => void) => handlers.set(event, handler)),
        off: jest.fn()
    }
    const { result } = renderHook(() => {
        const [previews, setPreviews] = useState<Record<string, LastPreview>>({})
        const [, setRooms] = useState<Record<number, number>>({})
        const [unread, setUnread] = useState<Record<string, number>>({})
        const focused = useRef(true)
        useMessagePreviewSideEffects(
            socket as unknown as Socket,
            "me",
            1,
            { name: "SameName", id: 10, isRoom: false },
            setPreviews,
            setRooms,
            setUnread,
            focused
        )
        return { previews, unread }
    })
    act(() =>
        handlers.get("message:receive")?.({
            sender_id: 20,
            receiver_id: 1,
            sender_username: "SameName",
            receiver_username: "me",
            content: "new owner"
        })
    )
    expect(result.current.previews["dm-20"].content).toBe("new owner")
    expect(result.current.previews["dm-10"]).toBeUndefined()
    expect(result.current.unread).toEqual({ "20": 1 })
    expect(isPeerNotifyMuted).toHaveBeenCalledWith(1, 20)
    expect(notifyMessage).toHaveBeenCalledTimes(1)
    act(() =>
        handlers.get("message:send:success")?.({ receiver_id: 20, receiver_username: "SameName", content: "reply" })
    )
    expect(result.current.previews["dm-20"].content).toBe("reply")
})
