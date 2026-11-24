import { act, fireEvent, render, screen } from "@testing-library/react"
import { HoldDeleteButton } from "./HoldDeleteButton"

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

it("requires the full keyboard hold and cancels an early release", () => {
    const complete = jest.fn()
    render(<HoldDeleteButton ariaLabel="Удалить аккаунт" onHoldComplete={complete} />)
    const button = screen.getByRole("button", { name: "Удалить аккаунт" })
    fireEvent.keyDown(button, { key: " " })
    act(() => jest.advanceTimersByTime(1500))
    fireEvent.keyUp(button, { key: " " })
    act(() => jest.advanceTimersByTime(2000))
    expect(complete).not.toHaveBeenCalled()
    fireEvent.keyDown(button, { key: "Enter" })
    act(() => jest.advanceTimersByTime(3100))
    expect(complete).toHaveBeenCalledTimes(1)
})

it("cancels a pending deletion when its dialog unmounts", () => {
    const complete = jest.fn()
    const { unmount } = render(<HoldDeleteButton ariaLabel="Удалить аккаунт" onHoldComplete={complete} />)
    fireEvent.keyDown(screen.getByRole("button"), { key: " " })
    act(() => jest.advanceTimersByTime(2000))
    unmount()
    act(() => jest.advanceTimersByTime(5000))
    expect(complete).not.toHaveBeenCalled()
})

it("cancels the hold when the action becomes disabled", () => {
    const complete = jest.fn()
    const { rerender } = render(<HoldDeleteButton ariaLabel="Удалить аккаунт" onHoldComplete={complete} />)
    fireEvent.keyDown(screen.getByRole("button"), { key: " " })
    act(() => jest.advanceTimersByTime(2000))
    rerender(<HoldDeleteButton ariaLabel="Удалить аккаунт" onHoldComplete={complete} disabled />)
    act(() => jest.advanceTimersByTime(5000))
    expect(complete).not.toHaveBeenCalled()
})
