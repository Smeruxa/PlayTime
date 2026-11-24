export function publicAssetUrl(pathUnderPublic: string): string {
    const p = pathUnderPublic.replace(/^\/+/, "")
    try {
        return new URL(p, document.baseURI).href
    } catch {
        return p
    }
}
