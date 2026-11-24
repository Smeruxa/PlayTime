export async function toggleScreenViewerFullscreen(container: HTMLElement | null): Promise<void> {
    if (!container) return
    if (document.fullscreenElement === container) {
        await document.exitFullscreen?.().catch(() => {})
    } else {
        await container.requestFullscreen?.().catch(() => {})
    }
}
