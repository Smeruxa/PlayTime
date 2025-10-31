declare global {
    interface Window {
        electronAPI: {
            sendNotification: (data: { name: string, text: string }) => void
            on: (channel: string, func: (...args: any[]) => void) => void
            off: (channel: string, func: (...args: any[]) => void) => void
        }
        windowControls?: {
            minimize: () => void
            maximize: () => void
            close: () => void
        }
    }
}

export {}