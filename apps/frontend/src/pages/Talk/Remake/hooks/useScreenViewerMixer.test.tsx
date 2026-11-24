import { act, renderHook } from "@testing-library/react"
import { useScreenViewerMixer } from "./useScreenViewerMixer"
import { getParticipantVolumePercent, setParticipantVolume } from "../../../../conversation/participantVolume"

it("changes only local demo audio and remembers each selected demo volume", () => {
    let change: (value: any) => void = () => {}
    const previous = window.electronAPI
    const bridge = {
        ...previous,
        screenShareViewerSetMixer: jest.fn(),
        screenShareViewerClose: jest.fn(),
        screenShareViewerOnMixerChange: jest.fn((callback) => {
            change = callback
            return () => {}
        })
    }
    window.electronAPI = bridge
    localStorage.setItem("valueSound", "83")
    setParticipantVolume("friend", 67)
    const setMuted = jest.fn()
    const { result, rerender, unmount } = renderHook(
        ({ screenKey }) =>
            useScreenViewerMixer({
                screenKey,
                screenLabel: "Demo",
                screenAvailable: true,
                screenMuted: false,
                setScreenMuted: setMuted
            }),
        { initialProps: { screenKey: "friend" } }
    )
    act(() => change({ kind: "screen", value: 35 }))
    expect(result.current.screenVolume).toBe(35)
    act(() => result.current.setScreenVolume(0))
    expect(result.current.screenVolume).toBe(0)
    expect(result.current.screenRestoreVolume).toBe(35)
    expect(setMuted).toHaveBeenLastCalledWith(true)
    act(() => result.current.setScreenVolume(result.current.screenRestoreVolume))
    expect(result.current.screenVolume).toBe(35)
    expect(setMuted).toHaveBeenLastCalledWith(false)
    expect(localStorage.getItem("valueSound")).toBe("83")
    expect(getParticipantVolumePercent("friend")).toBe(67)
    act(() => change({ kind: "master", value: 0 }))
    expect(localStorage.getItem("valueSound")).toBe("83")
    act(() => change({ kind: "screen", value: Number.NaN }))
    expect(result.current.screenVolume).toBe(35)
    rerender({ screenKey: "other" })
    expect(result.current.screenVolume).toBe(100)
    act(() => change({ kind: "screen", value: 0 }))
    expect(setMuted).toHaveBeenLastCalledWith(true)
    rerender({ screenKey: "friend" })
    expect(result.current.screenVolume).toBe(35)
    unmount()
    expect(bridge.screenShareViewerSetMixer).toHaveBeenLastCalledWith(null)
    window.electronAPI = previous
})
