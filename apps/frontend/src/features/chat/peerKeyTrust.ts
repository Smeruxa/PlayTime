import { currentKeyUserId } from "./keyVault"
import util from "tweetnacl-util"

const storageKey = (peer: string) => `playtime_peer_identity:${currentKeyUserId()}:${peer}`
export function trustPeerKey(peer: string, key: string, expectedUserId?: number | null): void {
    if (expectedUserId !== undefined && currentKeyUserId() !== expectedUserId) return
    const slot = storageKey(peer)
    const previous = localStorage.getItem(slot)
    if (previous && previous !== key) localStorage.setItem(`${slot}:history:${previous}`, "1")
    localStorage.setItem(slot, key)
}
export function checkPeerKey(peer: string, key: string, displayName = peer): boolean {
    const previous = localStorage.getItem(storageKey(peer))
    if (!previous) {
        trustPeerKey(peer, key)
        return true
    }
    if (previous === key) return true
    window.dispatchEvent(
        new CustomEvent("playtime:peer-key-changed", {
            detail: { peer, displayName, userId: currentKeyUserId(), previous, key }
        })
    )
    return false
}
export function checkMessageKey(id: number | undefined, key: string | null | undefined, name?: string, history = false): boolean {
    if (!Number.isSafeInteger(id) || !id || id < 1 || !key || currentKeyUserId() == null) return false
    const peer = `dm:${id}`
    if (history && localStorage.getItem(`${storageKey(peer)}:history:${key}`) === "1") return true
    return checkPeerKey(peer, key, name ?? String(id))
}

export async function keyFingerprint(publicKey: string): Promise<string> {
    const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(util.decodeBase64(publicKey)).buffer)
    )
    return Array.from(digest, (value) => value.toString(16).padStart(2, "0"))
        .join("")
        .match(/.{1,4}/g)!
        .join(" ")
}
