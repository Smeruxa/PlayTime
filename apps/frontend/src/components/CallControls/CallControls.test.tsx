import { fireEvent, render, screen } from "@testing-library/react"
import CallControls from "./CallControls"
const previousApi = window.electronAPI
afterEach(() => {
    window.electronAPI = previousApi
})

test("web screen sharing is disabled with an explanation while call controls remain usable", () => {
    window.electronAPI = undefined as unknown as Window["electronAPI"]
    const share = jest.fn(),
        mic = jest.fn(),
        end = jest.fn()
    render(<CallControls mic toggleMic={mic} end={end} onScreenShare={share} />)
    const button = screen.getByRole("button", { name: "Демонстрация экрана" })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription("Демонстрация экрана доступна в приложении PlayTime.")
    fireEvent.click(button)
    expect(share).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Выключить микрофон" }))
    fireEvent.click(screen.getByRole("button", { name: "Завершить звонок" }))
    expect(mic).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
})

test("the desktop screen sharing control remains available", () => {
    window.electronAPI = {} as Window["electronAPI"]
    const share = jest.fn()
    render(<CallControls mic toggleMic={jest.fn()} end={jest.fn()} onScreenShare={share} />)
    const button = screen.getByRole("button", { name: "Демонстрация экрана" })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(share).toHaveBeenCalledTimes(1)
})
