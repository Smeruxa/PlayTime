import { act, renderHook } from "@testing-library/react"
import { useVoiceRecorder } from "./useVoiceRecorder"

const originalRecorder = window.MediaRecorder
const originalDevices = navigator.mediaDevices
const stopTrack = jest.fn()
const getUserMedia = jest.fn()
const captures: FakeRecorder[] = []
class FakeRecorder {
    static isTypeSupported = (mime: string) => mime === "audio/mp4"
    state = "inactive"
    mimeType: string
    onstop: (() => void) | null = null
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    constructor(_stream: MediaStream, options: MediaRecorderOptions) {
        this.mimeType = options.mimeType || "audio/mp4"
        captures.push(this)
    }
    start() { this.state = "recording" }
    stop() {
        this.state = "inactive"
        this.ondataavailable?.({ data: new Blob([new Uint8Array(100)], { type: this.mimeType }) })
        this.onstop?.()
    }
}
beforeEach(() => {
    jest.useFakeTimers()
    captures.length = 0
    stopTrack.mockClear()
    getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] })
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } })
    window.MediaRecorder = FakeRecorder as unknown as typeof MediaRecorder
    URL.createObjectURL = jest.fn(() => "blob:voice-test")
    URL.revokeObjectURL = jest.fn()
})
afterEach(() => {
    jest.useRealTimers()
    window.MediaRecorder = originalRecorder
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalDevices })
})

test("uses MP4 when the browser does not support WebM and releases the preview on unmount", async () => {
    const { result, unmount } = renderHook(() => useVoiceRecorder())
    await act(async () => { await result.current.startRecording() })
    expect(result.current.phase).toBe("recording")
    act(() => result.current.stopRecording())
    expect(result.current.previewBlob?.type).toBe("audio/mp4")
    expect(stopTrack).toHaveBeenCalledTimes(1)
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:voice-test")
})

test.each(["cancel", "unmount"])("stops a microphone granted after %s", async (action) => {
    let resolve: (stream: MediaStream) => void = () => {}
    getUserMedia.mockImplementation(() => new Promise((done) => { resolve = done }))
    const { result, unmount } = renderHook(() => useVoiceRecorder())
    let starting: Promise<void>
    act(() => { starting = result.current.startRecording() })
    if (action === "cancel") act(() => result.current.cancelRecording())
    else unmount()
    await act(async () => {
        resolve({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream)
        await starting
    })
    expect(captures).toHaveLength(0)
    expect(stopTrack).toHaveBeenCalledTimes(1)
})

test("shows a useful permission error and allows another attempt", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
    const { result } = renderHook(() => useVoiceRecorder())
    await act(async () => { await result.current.startRecording() })
    expect(result.current.error).toContain("Разрешите доступ")
    await act(async () => { await result.current.startRecording() })
    expect(result.current.error).toBeNull()
    expect(result.current.phase).toBe("recording")
})

test("caps recording duration even when animation frames are suspended", async () => {
    const { result } = renderHook(() => useVoiceRecorder(2))
    await act(async () => { await result.current.startRecording() })
    act(() => jest.advanceTimersByTime(2_000))
    expect(result.current.phase).toBe("preview")
    expect(result.current.previewDurationSec).toBe(2)
    expect(stopTrack).toHaveBeenCalledTimes(1)
})
