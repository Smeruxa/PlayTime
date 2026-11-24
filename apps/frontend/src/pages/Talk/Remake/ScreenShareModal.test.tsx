import { act, fireEvent, render, screen } from "@testing-library/react"
import ScreenShareModal from "./ScreenShareModal"
import { captureScreenShare } from "../../../webrtc/screenCapture"

jest.mock("../../../webrtc/screenCapture", () => ({
    ...jest.requireActual("../../../webrtc/screenCapture"),
    captureScreenShare: jest.fn()
}))
const originalApi = window.electronAPI
const originalDevices = navigator.mediaDevices
const originalMatchMedia = window.matchMedia

beforeEach(() => {
    window.electronAPI = undefined as unknown as Window["electronAPI"]
    window.matchMedia = jest.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getDisplayMedia: jest.fn() } })
})
afterEach(() => {
    window.electronAPI = originalApi
    window.matchMedia = originalMatchMedia
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalDevices })
})

test("a browser cannot open a picker even if the modal is mounted directly", () => {
    const onClose = jest.fn()
    render(<ScreenShareModal onClose={onClose} onSelect={jest.fn()} />)
    expect(screen.getByText("Демонстрация экрана доступна в приложении PlayTime.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Выбрать экран" })).not.toBeInTheDocument()
    expect(captureScreenShare).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Понятно" }))
    expect(onClose).toHaveBeenCalledTimes(1)
})

test("closing while the desktop system picker is open stops a late capture instead of sharing it", async () => {
    window.electronAPI = {} as Window["electronAPI"]
    let resolve: (stream: MediaStream) => void = () => {}
    ;(captureScreenShare as jest.Mock).mockImplementation(
        () =>
            new Promise((done) => {
                resolve = done
            })
    )
    const onSelect = jest.fn(),
        stop = jest.fn()
    const { unmount } = render(<ScreenShareModal onClose={() => {}} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole("button", { name: "Выбрать экран" }))
    unmount()
    await act(async () => resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream))
    expect(onSelect).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledTimes(1)
})
