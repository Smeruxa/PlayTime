import { act, fireEvent, render, screen } from "@testing-library/react"
import SettingsModal from "./SettingsModal"

jest.mock("../../server/socketContext", () => ({ useCallState: () => ({ activeCall: null }) }))
const originalDevices = navigator.mediaDevices
const originalMatchMedia = window.matchMedia

beforeEach(() => {
    window.matchMedia = jest.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia
})

afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalDevices })
    window.matchMedia = originalMatchMedia
})

test("settings remain usable when the browser has no media-device API", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined })
    render(<SettingsModal onClose={() => {}} />)
    fireEvent.pointerDown(screen.getByRole("button", { name: "Удержать — уровень" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTPS")
})

test.each(["release", "unmount"])("a late permission grant stops capture after %s", async (action) => {
    let resolve: (stream: MediaStream) => void = () => {}
    const stop = jest.fn()
    const getUserMedia = jest.fn(
        () =>
            new Promise<MediaStream>((done) => {
                resolve = done
            })
    )
    Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
            enumerateDevices: async () => [],
            getUserMedia,
            addEventListener() {},
            removeEventListener() {}
        }
    })
    const { unmount } = render(<SettingsModal onClose={() => {}} />)
    const button = screen.getByRole("button", { name: "Удержать — уровень" })
    fireEvent.pointerDown(button)
    if (action === "release") fireEvent.pointerUp(button)
    else unmount()
    await act(async () => resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
})

test("microphone selection preserves storage and remains usable when devices disappear", async () => {
    localStorage.removeItem("playtime_audio_input_id")
    const device = (deviceId: string, label: string): MediaDeviceInfo => ({
        deviceId,
        label,
        kind: "audioinput",
        groupId: "qa",
        toJSON: () => ({})
    })
    let devices = [device("", "Anonymous"), device("alpha", "Microphone Alpha"), device("beta", "Microphone Beta")]
    let changed: (() => void) | undefined
    const getUserMedia = jest.fn()
    Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
            enumerateDevices: async () => devices,
            getUserMedia,
            addEventListener: (_event: string, callback: () => void) => {
                changed = callback
            },
            removeEventListener() {}
        }
    })
    render(<SettingsModal onClose={() => {}} />)
    await act(async () => {})
    const trigger = screen.getByRole("combobox", { name: "Микрофон" })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.queryByRole("option", { name: "Anonymous" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("option", { name: "Microphone Beta" }))
    expect(localStorage.getItem("playtime_audio_input_id")).toBe("beta")
    fireEvent.click(trigger)
    devices = []
    await act(async () => changed?.())
    expect(screen.getAllByRole("option")).toHaveLength(1)
    expect(localStorage.getItem("playtime_audio_input_id")).toBe("beta")
    fireEvent.click(screen.getByRole("option", { name: "По умолчанию" }))
    expect(localStorage.getItem("playtime_audio_input_id")).toBeNull()
    expect(trigger).toHaveFocus()
    expect(getUserMedia).not.toHaveBeenCalled()
})
