import { useCallback, useEffect, useMemo, useState } from "react"
import type { ScreenViewerMixer, ScreenViewerMixerChange } from "../../../../types/screenViewer"

type Options = {
    screenKey: string | null
    screenLabel: string
    screenAvailable: boolean
    screenMuted: boolean
    setScreenMuted: (value: boolean) => void
}
export function useScreenViewerMixer({
    screenKey,
    screenLabel,
    screenAvailable,
    screenMuted,
    setScreenMuted
}: Options) {
    const [screenLevels, setScreenLevels] = useState<Record<string, { value: number; restore: number }>>({})
    const screen = screenKey ? (screenLevels[screenKey]?.value ?? 100) : 100
    const screenRestoreVolume = screenKey ? (screenLevels[screenKey]?.restore ?? 100) : 100
    const setScreenVolume = useCallback(
        (value: number) => {
            if (!screenKey || !screenAvailable || !Number.isFinite(value)) return
            const next = Math.max(0, Math.min(100, value))
            setScreenLevels((previous) => ({
                ...previous,
                [screenKey]: { value: next, restore: next > 0 ? next : (previous[screenKey]?.restore ?? 100) }
            }))
            setScreenMuted(next === 0)
        },
        [screenKey, screenAvailable, setScreenMuted]
    )
    const state = useMemo<ScreenViewerMixer>(
        () => ({ screen, screenMuted, screenAvailable, screenLabel }),
        [screen, screenMuted, screenAvailable, screenLabel]
    )
    useEffect(() => {
        window.electronAPI?.screenShareViewerSetMixer?.(state)
    }, [state])
    useEffect(() => {
        const change = (value: ScreenViewerMixerChange) => {
            if (
                value?.kind !== "screen" ||
                !Number.isFinite(value.value) ||
                value.value < 0 ||
                value.value > 100 ||
                !screenAvailable ||
                !screenKey
            )
                return
            setScreenVolume(value.value)
        }
        return window.electronAPI?.screenShareViewerOnMixerChange?.(change)
    }, [screenKey, screenAvailable, setScreenVolume])
    useEffect(
        () => () => {
            window.electronAPI?.screenShareViewerSetMixer?.(null)
            window.electronAPI?.screenShareViewerClose?.()
        },
        []
    )
    return {
        screenVolume: screen,
        screenRestoreVolume,
        setScreenVolume
    }
}
