import { act, renderHook } from "@testing-library/react"
import type { Socket } from "socket.io-client"
import { useSocketMyName } from "./useSocketMyName"

function connection() {
    let reply!: (user: { username: string; userId: number }) => void
    return {
        socket: {
            on: jest.fn(),
            off: jest.fn(),
            emit: (_event: string, callback: typeof reply) => {
                reply = callback
            }
        } as unknown as Socket,
        respond(user: { username: string; userId: number }) {
            reply(user)
        }
    }
}
const jwt = (id: number) => `header.${btoa(JSON.stringify({ id, username: `user${id}` }))}.signature`

test("a delayed username acknowledgement from a disconnected account cannot overwrite the new identity", () => {
    const first = connection(),
        second = connection()
    const { result, rerender } = renderHook(({ socket, token }) => useSocketMyName(socket, token), {
        initialProps: { socket: first.socket, token: jwt(1) }
    })
    rerender({ socket: second.socket, token: jwt(2) })
    act(() => second.respond({ username: "second", userId: 2 }))
    act(() => first.respond({ username: "first", userId: 1 }))
    expect(result.current.myName).toBe("second")
    expect(result.current.myUserId).toBe(2)
})
