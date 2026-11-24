import { checkMessageKey, checkPeerKey, trustPeerKey } from "./peerKeyTrust"
import { currentKeyUserId } from "./keyVault"
jest.mock("./keyVault", () => ({ currentKeyUserId: jest.fn() }))

beforeEach(() => { localStorage.clear(); (currentKeyUserId as jest.Mock).mockReturnValue(1) })
test("trust records bind account IDs and a late confirmation cannot write into another login", () => {
    expect(checkPeerKey("dm:10", "first-key", "SameName")).toBe(true)
    expect(checkPeerKey("dm:20", "new-owner-key", "SameName")).toBe(true)
    const changed = jest.fn()
    window.addEventListener("playtime:peer-key-changed", changed)
    expect(checkPeerKey("dm:10", "changed-key", "SameName")).toBe(false)
    expect(changed.mock.calls[0][0].detail).toMatchObject({ peer: "dm:10", displayName: "SameName", userId: 1 })
    ;(currentKeyUserId as jest.Mock).mockReturnValue(2)
    trustPeerKey("dm:10", "changed-key", 1)
    expect(localStorage.getItem("playtime_peer_identity:2:dm:10")).toBeNull()
    window.removeEventListener("playtime:peer-key-changed", changed)
})

test("only confirmed replacements retire a key and archived keys only open history", () => {
    expect(checkMessageKey(10, "original")).toBe(true)
    expect(checkMessageKey(10, "unconfirmed", "Peer", true)).toBe(false)
    trustPeerKey("dm:10", "replacement", 1)
    expect(checkMessageKey(10, "original", "Peer", true)).toBe(true)
    expect(checkMessageKey(10, "original")).toBe(false)
    expect(checkMessageKey(10, "replacement")).toBe(true)
    expect(checkMessageKey(undefined, "replacement")).toBe(false)
})
