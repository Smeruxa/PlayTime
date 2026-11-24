import { captureScreenShare } from "./screenCapture"

describe("screen capture with system audio", () => {
    const originalDevices = navigator.mediaDevices
    const originalApi = window.electronAPI
    const getDisplayMedia = jest.fn()
    beforeEach(() => {
        getDisplayMedia.mockReset()
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getDisplayMedia } })
        window.electronAPI = {
            selectScreenSource: jest.fn().mockResolvedValue(undefined)
        } as unknown as Window["electronAPI"]
    })
    afterEach(() => {
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalDevices })
        window.electronAPI = originalApi
    })

    function stream(audio: { readyState: string }[]) {
        const stop = jest.fn()
        return { getAudioTracks: () => audio, getTracks: () => [{ stop }], stop } as unknown as MediaStream & {
            stop: jest.Mock
        }
    }

    it("requests system sound while excluding PlayTime playback and preserving local playback", async () => {
        const captured = stream([{ readyState: "live" }])
        getDisplayMedia.mockResolvedValue(captured)
        expect(await captureScreenShare(true, "screen:1:0")).toBe(captured)
        expect(window.electronAPI.selectScreenSource).toHaveBeenCalledWith("screen:1:0")
        expect(getDisplayMedia).toHaveBeenCalledWith(
            expect.objectContaining({
                systemAudio: "include",
                audio: expect.objectContaining({ restrictOwnAudio: true, suppressLocalAudioPlayback: false })
            })
        )
    })

    it.each([{ audio: [] }, { audio: [{ readyState: "ended" }] }])(
        "reports missing or dead system audio instead of silently sharing without sound: %j",
        async ({ audio }) => {
            const captured = stream(audio)
            getDisplayMedia.mockResolvedValue(captured)
            await expect(captureScreenShare(true)).rejects.toThrow("Звук компьютера недоступен")
            expect(captured.stop).toHaveBeenCalledTimes(1)
            expect(getDisplayMedia).toHaveBeenCalledTimes(1)
        }
    )

    it("allows an explicit video-only share", async () => {
        const captured = stream([])
        getDisplayMedia.mockResolvedValue(captured)
        expect(await captureScreenShare(false)).toBe(captured)
        expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false, systemAudio: "exclude" }))
        expect(captured.stop).not.toHaveBeenCalled()
    })

    it.each([false, true])("blocks browser capture before asking for permissions (audio: %s)", async (shareAudio) => {
        window.electronAPI = undefined as unknown as Window["electronAPI"]
        await expect(captureScreenShare(shareAudio)).rejects.toThrow("доступна в приложении PlayTime")
        expect(getDisplayMedia).not.toHaveBeenCalled()
    })

    it("a source id cannot bypass the web capture restriction", async () => {
        window.electronAPI = undefined as unknown as Window["electronAPI"]
        await expect(captureScreenShare(true, "screen:1:0")).rejects.toThrow("доступна в приложении PlayTime")
        expect(getDisplayMedia).not.toHaveBeenCalled()
    })

    it("explains unsupported screen capture and user denial", async () => {
        getDisplayMedia.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"))
        await expect(captureScreenShare(false)).rejects.toThrow("разрешите доступ")
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined })
        await expect(captureScreenShare(false)).rejects.toThrow("не поддерживает демонстрацию")
    })
})
