interface WindowControls {
    minimize: () => void
    maximize: () => void
    close: () => void
}
declare global {
    interface Window {
        windowControls?: WindowControls
    }
}
export {}