import { useMemo } from "react"
import { LOCAL_SCREEN_KEY } from "../constants"

export function useTalkScreenSources(isSharing: boolean, remoteScreens: Record<string, MediaStream>) {
    const remoteScreenKeysSig = Object.keys(remoteScreens).sort().join("\0")
    return useMemo(() => {
        const remotes = remoteScreenKeysSig ? remoteScreenKeysSig.split("\0") : []
        return [...(isSharing ? [LOCAL_SCREEN_KEY] : []), ...remotes]
    }, [isSharing, remoteScreenKeysSig])
}
