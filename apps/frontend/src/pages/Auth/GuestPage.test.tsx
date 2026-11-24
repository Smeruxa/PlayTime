import { act, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import GuestPage from "./GuestPage"

const mockSetToken = jest.fn()
jest.mock("../../server/socketContext", () => ({ useSessionSocket: () => ({ setToken: mockSetToken }) }))
jest.mock("../../utils/api/refreshHandoff", () => ({
    guestRequestKey: async () => "c".repeat(64),
    retireGuestRequest: async () => {},
    publishGuestRequest: async (_username: string, _key: string, publish: () => void, retired: () => void) => {
        publish()
        retired()
    }
}))
const previousFetch = global.fetch
const fetchMock = jest.fn()
beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    mockSetToken.mockClear()
    global.fetch = fetchMock
})
afterEach(() => {
    global.fetch = previousFetch
    jest.useRealTimers()
})
const page = () =>
    render(
        <MemoryRouter initialEntries={["/guest"]}>
            <Routes>
                <Route path="/guest" element={<GuestPage />} />
                <Route path="/content" element={<p>Сессия открыта</p>} />
                <Route path="/" element={<p>Выбор входа</p>} />
            </Routes>
        </MemoryRouter>
    )

test("reopening guest entry restores the nickname of an interrupted creation", () => {
    localStorage.setItem(
        "playtime:pending-guest",
        JSON.stringify({ username: "moonwalker", requestKey: "c".repeat(64) })
    )
    page()
    expect(screen.getByLabelText("Никнейм")).toHaveValue("moonwalker")
})

test("choosing another login method abandons the saved guest attempt", async () => {
    localStorage.setItem(
        "playtime:pending-guest",
        JSON.stringify({ username: "moonwalker", requestKey: "c".repeat(64) })
    )
    page()
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Другой способ входа" }))
    })
    expect(screen.getByText("Выбор входа")).toBeInTheDocument()
    expect(localStorage.getItem("playtime:pending-guest")).toBeNull()
})

test("timeout unlocks the guest form and a retry opens the original session", async () => {
    jest.useFakeTimers()
    fetchMock.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "access", refreshToken: "refresh" })
    })
    page()
    fireEvent.change(screen.getByLabelText("Никнейм"), { target: { value: "moonwalker" } })
    fireEvent.click(screen.getByRole("button", { name: "Начать общение" }))
    expect(screen.getByRole("button", { name: "Входим…" })).toBeDisabled()
    await act(async () => {
        await jest.advanceTimersByTimeAsync(12_001)
    })
    expect(screen.getByRole("alert")).toHaveTextContent("Сервер не ответил вовремя")
    expect(screen.getByRole("button", { name: "Начать общение" })).toBeEnabled()
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Начать общение" }))
    })
    expect(screen.getByText("Сессия открыта")).toBeInTheDocument()
    expect(mockSetToken).toHaveBeenCalledWith("access")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(JSON.parse(fetchMock.mock.calls[0][1].body))
})
