import type {
    IncomingCallAnswer,
    IncomingCallWindowBridge,
    IncomingCallWindowState
} from "./features/call/incomingCallWindowTypes"

declare global {
    class MediaStreamTrackProcessor<T extends VideoFrame = VideoFrame> {
        constructor(init: { track: MediaStreamTrack })
        readonly readable: ReadableStream<T>
    }

    interface Window {
        incomingCallAPI?: IncomingCallWindowBridge
        electronAPI: {
            setCallActive?: (active: boolean) => void
            showIncomingCall?: (state: IncomingCallWindowState) => void
            hideIncomingCall?: (roomId: string) => void
            onIncomingCallAnswer?: (callback: (answer: IncomingCallAnswer) => void) => () => void
            readEncryptionKeys?: (userId: number) => Promise<Record<string, string>>
            writeEncryptionKeys?: (userId: number, keys: Record<string, string>) => Promise<void>
            getWorkletPath: () => Promise<string>
            getScreenSources?: () => Promise<{ id: string; name: string; thumbnail: string }[]>
            selectScreenSource?: (sourceId: string) => Promise<void>
            sendNotification: (data: {
                peerUserId?: number
                name: string
                text: string
                isRoom?: boolean
                roomId?: number
                roomName?: string
            }) => void
            isWindowFocused?: () => Promise<boolean>
            onWindowFocusChanged?: (cb: (focused: boolean) => void) => () => void
            screenShareViewerOpen?: () => Promise<{ ok?: boolean; already?: boolean } | void>
            screenShareViewerSendFrame?: (dataUrl: string) => void
            screenShareViewerSetMixer?: (state: import("./types/screenViewer").ScreenViewerMixer | null) => void
            screenShareViewerOnMixerChange?: (
                cb: (change: import("./types/screenViewer").ScreenViewerMixerChange) => void
            ) => () => void
            screenShareViewerClose?: () => void
            screenShareViewerSubscribeClosed?: (cb: () => void) => () => void
            checkForUpdates: () => Promise<{ skipped?: boolean; ok?: boolean; version?: string | null; error?: string }>
            installUpdate: () => Promise<{ ok?: boolean; error?: string } | void>
            getUpdateState?: () => Promise<import("./hooks/useAppUpdate").UpdateState>
            openUpdateDownload?: () => Promise<{ ok?: boolean; error?: string }>
            onUpdateEvent: (cb: (channel: string, payload: Record<string, unknown>) => void) => () => void
            on: (channel: string, func: (...args: any[]) => void) => void
            off: (channel: string, func: (...args: any[]) => void) => void
        }
        windowControls?: {
            minimize: () => void
            maximize: () => void
            close: () => void
            focus?: () => void
        }
    }
}

export {}
