export type ScreenViewerMixer = {
    screen: number
    screenMuted: boolean
    screenAvailable: boolean
    screenLabel: string
}
export type ScreenViewerMixerChange = { kind: "screen"; value: number }
