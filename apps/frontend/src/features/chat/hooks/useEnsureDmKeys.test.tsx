import { act, renderHook, waitFor } from "@testing-library/react"
import type { Socket } from "socket.io-client"
import { useEnsureDmKeys } from "./useEnsureDmKeys"
import { hydrateKeys } from "../keyVault"
import { ensureDmKeyPair, getDmPublicKeyB64, profileSetDmPublicKey } from "../dmE2ee"

jest.mock("../keyVault", () => ({ hydrateKeys: jest.fn(), browserKeyStorageKey: (id: number) => `playtime_keys_dev:${id}` }))
jest.mock("../dmE2ee", () => ({
    ensureDmKeyPair: jest.fn(),
    getDmPublicKeyB64: jest.fn(),
    migrateLegacyDmKeyForUser: jest.fn(),
    profileSetDmPublicKey: jest.fn()
}))
const socket = (publicKey: string | null) =>
    ({
        timeout: () => ({
            emit: (_event: string, _data: unknown, callback: (error: null, data: unknown) => void) =>
                callback(null, { profile: { dmPublicKey: publicKey } })
        })
    }) as unknown as Socket
beforeEach(() => {
    jest.clearAllMocks()
    ;(hydrateKeys as jest.Mock).mockResolvedValue(undefined)
    ;(profileSetDmPublicKey as jest.Mock).mockResolvedValue({ ok: true })
    ;(ensureDmKeyPair as jest.Mock).mockResolvedValue("new-key")
})
test("another device cannot silently replace the account's encryption key", async () => {
    ;(getDmPublicKeyB64 as jest.Mock).mockReturnValue(null)
    const connection = socket("existing-key")
    const { result } = renderHook(() => useEnsureDmKeys(connection, 42))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.needsRecovery).toBe(true)
    expect(ensureDmKeyPair).not.toHaveBeenCalled()
    expect(profileSetDmPublicKey).not.toHaveBeenCalled()
})
test("a first-time account persists its new key before publishing it", async () => {
    ;(getDmPublicKeyB64 as jest.Mock).mockReturnValue(null)
    const connection = socket(null)
    const { result } = renderHook(() => useEnsureDmKeys(connection, 42))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(ensureDmKeyPair).toHaveBeenCalledWith(42)
    expect(profileSetDmPublicKey).toHaveBeenCalledWith(connection, "new-key")
    expect(result.current.error).toBe(null)
})
test("an unavailable system vault cannot trigger creation or replacement of a key", async () => {
    ;(hydrateKeys as jest.Mock).mockRejectedValue(new Error("vault unavailable"))
    const connection = socket(null)
    const { result } = renderHook(() => useEnsureDmKeys(connection, 42))
    await waitFor(() => expect(result.current.error).toBe("vault unavailable"))
    expect(ensureDmKeyPair).not.toHaveBeenCalled()
    expect(profileSetDmPublicKey).not.toHaveBeenCalled()
})
test("restoring the original key clears the recovery warning", async () => {
    ;(getDmPublicKeyB64 as jest.Mock).mockReturnValue(null)
    const connection = socket("existing-key")
    const { result } = renderHook(() => useEnsureDmKeys(connection, 42))
    await waitFor(() => expect(result.current.needsRecovery).toBe(true))
    ;(getDmPublicKeyB64 as jest.Mock).mockReturnValue("existing-key")
    act(() => window.dispatchEvent(new Event("playtime:keys-updated")))
    await waitFor(() => expect(result.current.needsRecovery).toBe(false))
    expect(profileSetDmPublicKey).toHaveBeenCalledWith(connection, "existing-key")
})

test("a DM identity restored by another browser tab is revalidated", async () => {
    const originalBridge = window.electronAPI
    window.electronAPI = undefined as unknown as Window["electronAPI"]
    try {
        ;(getDmPublicKeyB64 as jest.Mock).mockReturnValue(null)
        const connection = socket("existing-key")
        const { result } = renderHook(() => useEnsureDmKeys(connection, 42))
        await waitFor(() => expect(result.current.needsRecovery).toBe(true))
        ;(getDmPublicKeyB64 as jest.Mock).mockReturnValue("existing-key")
        act(() => window.dispatchEvent(new CustomEvent("playtime:keys-updated", { detail: { userId: 42 } })))
        await waitFor(() => expect(result.current.needsRecovery).toBe(false))
        expect(profileSetDmPublicKey).toHaveBeenCalledWith(connection, "existing-key")
    } finally { window.electronAPI = originalBridge }
})
