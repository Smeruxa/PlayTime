const TITLE_BAR_PX = 34
const PAD = 8

export function clampFloatingPanel(
    anchor: DOMRect,
    panelW: number,
    panelH: number,
    preferAbove = true
): { top: number; left: number } {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const minTop = TITLE_BAR_PX + PAD
    const maxBottom = vh - PAD

    let left = anchor.right - panelW
    if (left + panelW + PAD > vw) left = vw - panelW - PAD
    if (left < PAD) left = PAD

    const spaceAbove = anchor.top - minTop
    const spaceBelow = maxBottom - anchor.bottom
    const placeAbove = preferAbove ? spaceAbove >= panelH + PAD || spaceAbove >= spaceBelow : spaceBelow < panelH + PAD

    let top: number
    if (placeAbove) {
        top = anchor.top - panelH - PAD
        if (top < minTop) top = minTop
    } else {
        top = anchor.bottom + PAD
        if (top + panelH > maxBottom) top = maxBottom - panelH
    }

    return { top, left }
}
