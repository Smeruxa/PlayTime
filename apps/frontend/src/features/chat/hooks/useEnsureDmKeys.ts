import { useEffect, useState } from "react"
import type { Socket } from "socket.io-client"
import { ensureDmKeyPair, getDmPublicKeyB64, migrateLegacyDmKeyForUser, profileSetDmPublicKey } from "../dmE2ee"
import { hydrateKeys } from "../keyVault"

export function useEnsureDmKeys(socket: Socket | null, myUserId: number | null) {
    const [state, setState] = useState<{
        userId: number | null
        ready: boolean
        error: string | null
        needsRecovery: boolean
    }>({
        userId: null,
        ready: false,
        error: null,
        needsRecovery: false
    })
    const [revision, setRevision] = useState(0)
    useEffect(() => {
        const onChange = (event: Event) => {
            const detail = (event as CustomEvent<{ userId?: number }>).detail
            if (detail?.userId != null && detail.userId !== myUserId) return
            setRevision((v) => v + 1)
        }
        window.addEventListener("playtime:keys-updated", onChange)
        return () => {
            window.removeEventListener("playtime:keys-updated", onChange)
        }
    }, [myUserId])
    useEffect(() => {
        if (!socket || myUserId == null) return
        let cancelled = false
        void (async () => {
            try {
                const remote = await new Promise<string | null>((resolve, reject) => {
                    socket
                        .timeout(10_000)
                        .emit(
                            "profile:get",
                            {},
                            (
                                error: Error | null,
                                response: { err?: string; profile?: { dmPublicKey?: string | null } }
                            ) => {
                                if (error || response?.err || !response?.profile)
                                    reject(new Error("Не удалось проверить ключи аккаунта. Проверьте подключение."))
                                else resolve(response.profile.dmPublicKey ?? null)
                            }
                        )
                })
                if (cancelled) return
                await hydrateKeys(myUserId)
                if (cancelled) return
                await migrateLegacyDmKeyForUser(myUserId, remote)
                if (cancelled) return
                let pub = getDmPublicKeyB64(myUserId)
                if (remote && remote !== pub) {
                    setState({
                        userId: myUserId,
                        ready: true,
                        error: "На другом устройстве уже есть ключ переписки. Восстановите его копию в профиле → Аккаунт. Создание нового ключа лишит доступа к старым сообщениям на этом устройстве.",
                        needsRecovery: true
                    })
                    return
                }
                if (!pub) pub = await ensureDmKeyPair(myUserId)
                const res = await profileSetDmPublicKey(socket, pub)
                if (!res.ok) throw new Error(res.err || "Не удалось сохранить ключ")
                if (!cancelled) setState({ userId: myUserId, ready: true, error: null, needsRecovery: false })
            } catch (error) {
                if (!cancelled)
                    setState({
                        userId: myUserId,
                        ready: true,
                        error: error instanceof Error ? error.message : "Не удалось открыть ключи",
                        needsRecovery: false
                    })
            }
        })()
        return () => {
            cancelled = true
        }
    }, [socket, myUserId, revision])
    return state.userId === myUserId ? state : { ready: false, error: null, needsRecovery: false }
}
