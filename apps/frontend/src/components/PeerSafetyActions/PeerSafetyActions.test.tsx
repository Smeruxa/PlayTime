import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PeerSafetyActions } from "./PeerSafetyActions"
import { useSessionSocket } from "../../server/socketContext"

jest.mock("../../server/socketContext", () => ({ useSessionSocket: jest.fn() }))
jest.mock("../../config", () => ({ API_BASE: "https://api.test" }))
jest.mock("../../ui", () => ({
    Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />
}))
const session = useSessionSocket as jest.Mock
const originalFetch = global.fetch
beforeEach(() => session.mockReturnValue({ token: "owner-token", myUserId: 1 }))
afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
})

test("blocked lookup and actions use the selected account ID despite a shared nickname", async () => {
    const fetcher = jest
        .fn()
        .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ peers: [{ user_id: 10, username: "SameName", archived: true }] })
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    global.fetch = fetcher
    jest.spyOn(window, "confirm").mockReturnValue(true)
    render(<PeerSafetyActions username="SameName" peerUserId={20} />)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText("Заблокировать"))
    await screen.findByText("Пользователь заблокирован.")
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ peerUserId: 20 })
})

test("switching account or peer clears report text and ignores a late block response", async () => {
    let complete!: (response: unknown) => void
    const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ peers: [] }) })
    global.fetch = fetcher
    jest.spyOn(window, "confirm").mockReturnValue(true)
    const { rerender } = render(<PeerSafetyActions username="SameName" peerUserId={10} />)
    fireEvent.click(screen.getByText("Пожаловаться"))
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "old private reason" } })
    fetcher.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                complete = resolve
            })
    )
    fireEvent.click(screen.getByText("Заблокировать"))
    session.mockReturnValue({ token: "new-owner-token", myUserId: 2 })
    rerender(<PeerSafetyActions username="SameName" peerUserId={20} />)
    expect(screen.queryByRole("textbox")).toBeNull()
    await act(async () => complete({ ok: true, json: async () => ({}) }))
    expect(screen.queryByText("Пользователь заблокирован.")).toBeNull()
    expect(screen.getByText("Заблокировать")).toBeEnabled()
})

test("an older blocked-list response cannot undo a newly acknowledged block", async () => {
    let complete!: (response: unknown) => void
    const fetcher = jest
        .fn()
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    complete = resolve
                })
        )
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    global.fetch = fetcher
    jest.spyOn(window, "confirm").mockReturnValue(true)
    render(<PeerSafetyActions username="SameName" peerUserId={20} />)
    fireEvent.click(screen.getByText("Заблокировать"))
    await screen.findByText("Пользователь заблокирован.")
    await act(async () => complete({ ok: true, json: async () => ({ peers: [] }) }))
    expect(screen.getByText("Разблокировать")).toBeEnabled()
})
