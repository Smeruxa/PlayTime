import { useCallback, useEffect, useState } from "react"
import { fetchCheckoutAccount, type CheckoutAccount } from "./billingApi"

type AccountState = { revision: number; account: CheckoutAccount | null; error: string | null }

export function useCheckoutAccount() {
    const [revision, setRevision] = useState(0)
    const [result, setResult] = useState<AccountState | null>(null)
    const refresh = useCallback(() => setRevision((value) => value + 1), [])
    useEffect(() => {
        const storage = (event: StorageEvent) => {
            if (!event.key || event.key === "token") refresh()
        }
        window.addEventListener("focus", refresh)
        window.addEventListener("storage", storage)
        return () => {
            window.removeEventListener("focus", refresh)
            window.removeEventListener("storage", storage)
        }
    }, [refresh])
    useEffect(() => {
        const controller = new AbortController()
        fetchCheckoutAccount(controller.signal).then(
            (account) => {
                if (!controller.signal.aborted) setResult({ revision, account, error: null })
            },
            (failure: unknown) => {
                const error = failure instanceof Error ? failure.message : "Не удалось проверить аккаунт."
                if (!controller.signal.aborted) setResult({ revision, account: null, error })
            },
        )
        return () => controller.abort()
    }, [revision])
    const current = result?.revision === revision ? result : null
    return { account: current?.account ?? null, error: current?.error ?? null, refresh }
}
