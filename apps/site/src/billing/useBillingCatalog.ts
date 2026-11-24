import { useCallback, useEffect, useState } from "react"
import { fetchBillingCatalog } from "./billingApi"
import type { BillingCatalog } from "./types"

export function useBillingCatalog() {
    const [catalog, setCatalog] = useState<BillingCatalog | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)
    useEffect(() => {
        const controller = new AbortController()
        void fetchBillingCatalog(controller.signal)
            .then((value) => {
                if (!controller.signal.aborted) setCatalog(value)
            })
            .catch((error) => {
                if (!controller.signal.aborted)
                    setError(error instanceof Error ? error.message : "Не удалось загрузить условия оплаты.")
            })
        return () => controller.abort()
    }, [revision])
    const retry = useCallback(() => {
        setError(null)
        setRevision((value) => value + 1)
    }, [])
    return { catalog, error, retry }
}
