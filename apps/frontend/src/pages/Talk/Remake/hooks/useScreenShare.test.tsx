import { act, renderHook } from "@testing-library/react"
import { useScreenShare } from "./useScreenShare"
import type { VoiceMesh, RemoteScreenEvent } from "../../../../webrtc/voiceMesh"

test("web rejects outgoing streams and continues receiving another participant's screen", () => {
    const previous = window.electronAPI
    window.electronAPI = undefined as unknown as Window["electronAPI"]
    let receive!: (event: RemoteScreenEvent) => void
    const publish = jest.fn(async () => {})
    const mesh = {
        setScreenShare: publish,
        onScreenShare: (listener: typeof receive) => { receive = listener; return () => {} }
    } as unknown as VoiceMesh
    const stop = jest.fn()
    const outgoing = { getTracks: () => [{ stop }] } as unknown as MediaStream
    const incoming = {} as MediaStream
    const { result, unmount } = renderHook(() => useScreenShare({ current: mesh }, true))
    try {
        act(() => result.current.startScreenShare(outgoing))
        expect(stop).toHaveBeenCalledTimes(1)
        expect(publish).not.toHaveBeenCalledWith(outgoing)
        expect(result.current.isSharing).toBe(false)
        expect(result.current.localStream).toBeNull()
        act(() => receive({ userId: 2, username: "desktop-user", stream: incoming }))
        expect(result.current.remoteScreens["desktop-user"]).toBe(incoming)
    } finally { unmount(); window.electronAPI = previous }
})
