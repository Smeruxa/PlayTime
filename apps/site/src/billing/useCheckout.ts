import { useCallback, useEffect, useRef, useState } from "react"
import { BillingError, confirmationUrl, createCheckout, fetchCheckout } from "./billingApi"
import { checkoutRequest, forgetAttempt, newAttempt, saveAttempt } from "./checkoutSession"
import type { CheckoutAttempt, CheckoutOrder, CheckoutRequest } from "./types"

const pollWindowMs = 2 * 60_000
const finished = (order: CheckoutOrder | null) =>
    order?.status === "succeeded" || order?.status === "canceled" || order?.status === "expired"
const errorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Не удалось проверить платёж. Попробуйте снова."

type Options = { initial: CheckoutAttempt | null; onOrder: (order: CheckoutOrder) => void }
export function useCheckout({ initial, onOrder }: Options) {
    const [attempt, setAttempt] = useState(initial)
    const [order, setOrder] = useState<CheckoutOrder | null>(null)
    const [busy, setBusy] = useState(false)
    const [needsLogin, setNeedsLogin] = useState(false)
    const [uncertain, setUncertain] = useState(!!initial && !initial.orderId)
    const [error, setError] = useState<string | null>(null)
    const [paused, setPaused] = useState(false)
    const [revision, setRevision] = useState(0)
    const [retryAt, setRetryAt] = useState(initial?.retryAt ?? 0)
    const [now, setNow] = useState(Date.now)
    const current = useRef(attempt)
    const currentOrder = useRef(order)
    const orderCallback = useRef(onOrder)
    useEffect(() => {
        orderCallback.current = onOrder
    }, [onOrder])
    const createController = useRef<AbortController | null>(null)
    const createGeneration = useRef(0)
    const redirectRequested = useRef(false)

    useEffect(
        () => () => {
            createGeneration.current++
            createController.current?.abort()
        },
        []
    )
    useEffect(() => {
        if (retryAt <= Date.now()) return
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [retryAt])

    const accept = useCallback((response: CheckoutOrder, expected: CheckoutAttempt) => {
        if (
            expected.planSlug !== response.plan.slug ||
            (expected.orderId && expected.orderId !== response.orderId)
        ) {
            throw new BillingError("invalid_response")
        }
        const updated = {
            ...expected,
            orderId: response.orderId,
            status: response.status,
            retryAt: undefined,
            accessExpiresAt: response.accessExpiresAt,
        }
        saveAttempt(updated)
        current.current = updated
        currentOrder.current = response
        setUncertain(false)
        setAttempt(updated)
        setOrder(response)
        setError(null)
        orderCallback.current(response)
        if (redirectRequested.current && response.status === "pending") {
            redirectRequested.current = false
            const url = confirmationUrl(response.confirmationUrl)
            if (!url) throw new Error("Не удалось открыть оплату. Попробуйте ещё раз.")
            window.location.assign(url)
        }
        if (finished(response)) redirectRequested.current = false
    }, [])

    const create = useCallback(
        async (next: CheckoutAttempt) => {
            if (Date.now() < retryAt) return
            const generation = ++createGeneration.current
            createController.current?.abort()
            const controller = new AbortController()
            createController.current = controller
            setBusy(true)
            setNeedsLogin(false)
            setError(null)
            setPaused(false)
            redirectRequested.current = true
            try {
                saveAttempt(next)
                current.current = next
                setAttempt(next)
                const response = await createCheckout(checkoutRequest(next), controller.signal)
                if (generation !== createGeneration.current || controller.signal.aborted) return
                accept(response, next)
            } catch (error) {
                if (controller.signal.aborted || generation !== createGeneration.current) return
                setNeedsLogin(error instanceof BillingError && error.code === "login_required")
                const rejected =
                    error instanceof BillingError &&
                    ["invalid_checkout", "account_not_found"].includes(error.code)
                if (rejected) {
                    try {
                        forgetAttempt(next.requestId)
                    } catch {
                    }
                    current.current = null
                    setAttempt(null)
                }
                setUncertain(!rejected && current.current?.requestId === next.requestId)
                setError(errorMessage(error))
                if (error instanceof BillingError) {
                    const nextRetryAt = error.retryAfterMs > 0 ? Date.now() + error.retryAfterMs : 0
                    setNow(Date.now())
                    setRetryAt(nextRetryAt)
                    if (!rejected && current.current?.requestId === next.requestId) {
                        const preserved = { ...current.current, retryAt: nextRetryAt }
                        current.current = preserved
                        setAttempt(preserved)
                        try {
                            saveAttempt(preserved)
                        } catch {
                        }
                    }
                }
            } finally {
                if (generation === createGeneration.current) setBusy(false)
            }
        },
        [accept, retryAt]
    )

    const start = useCallback(
        (form: Pick<CheckoutRequest, "planSlug" | "username" | "email">) => {
            const previous = current.current
            const same =
                previous &&
                !previous.orderId &&
                previous.planSlug === form.planSlug &&
                previous.username === form.username &&
                previous.email === form.email
            void create(same ? previous : newAttempt(form))
        },
        [create]
    )
    const restore = useCallback(() => {
        if (Date.now() < retryAt) return
        setPaused(false)
        if (current.current && !current.current.orderId) void create(current.current)
        else setRevision((value) => value + 1)
    }, [create, retryAt])
    const reset = useCallback(() => {
        createGeneration.current++
        createController.current?.abort()
        current.current = null
        currentOrder.current = null
        redirectRequested.current = false
        setUncertain(false)
        setAttempt(null)
        setOrder(null)
        setError(null)
        setBusy(false)
        setPaused(false)
    }, [])

    useEffect(() => {
        if (!attempt?.orderId) return
        const expected = attempt
        const orderId = attempt.orderId
        let disposed = false
        let inFlight = false
        let wakePending = false
        let startedAt = Date.now()
        let unchanged = 0
        let previousStatus = currentOrder.current?.status
        let timer: ReturnType<typeof setTimeout> | undefined
        let controller: AbortController | undefined
        const run = async () => {
            if (disposed || document.hidden || inFlight || finished(currentOrder.current)) return
            if (Date.now() - startedAt >= pollWindowMs) {
                setPaused(true)
                return
            }
            inFlight = true
            wakePending = false
            controller = new AbortController()
            let delay = 3000
            let stop = false
            try {
                const response = await fetchCheckout(
                    orderId,
                    expected.statusToken,
                    controller.signal
                )
                if (
                    disposed ||
                    controller.signal.aborted ||
                    current.current?.requestId !== expected.requestId
                )
                    return
                unchanged = previousStatus === response.status ? unchanged + 1 : 0
                previousStatus = response.status
                accept(response, expected)
                delay = Math.min(
                    15_000,
                    Math.max(3000, response.pollAfterMs) * Math.pow(1.5, unchanged)
                )
                stop = finished(response)
            } catch (error) {
                if (
                    disposed ||
                    controller.signal.aborted ||
                    current.current?.requestId !== expected.requestId
                )
                    return
                setError(errorMessage(error))
                unchanged++
                delay = Math.min(15_000, 3000 * Math.pow(1.5, unchanged))
                if (error instanceof BillingError) {
                    delay = Math.max(delay, error.retryAfterMs)
                    setNow(Date.now())
                    setRetryAt(error.retryAfterMs > 0 ? Date.now() + error.retryAfterMs : 0)
                    if (error.code === "order_not_found") {
                        stop = true
                        setPaused(true)
                    }
                }
            } finally {
                inFlight = false
                if (!disposed && !document.hidden && !stop) {
                    if (wakePending) void run()
                    else timer = setTimeout(() => void run(), delay)
                }
            }
        }
        const wake = () => {
            clearTimeout(timer)
            if (document.hidden) {
                controller?.abort()
                return
            }
            startedAt = Date.now()
            unchanged = 0
            setPaused(false)
            wakePending = true
            if (!inFlight) void run()
        }
        document.addEventListener("visibilitychange", wake)
        window.addEventListener("focus", wake)
        void run()
        return () => {
            disposed = true
            clearTimeout(timer)
            controller?.abort()
            document.removeEventListener("visibilitychange", wake)
            window.removeEventListener("focus", wake)
        }
    }, [attempt?.requestId, attempt?.orderId, revision, accept])

    return {
        attempt,
        order,
        busy,
        uncertain,
        needsLogin,
        error,
        paused,
        start,
        restore,
        reset,
        retrySeconds: Math.max(0, Math.ceil((retryAt - now) / 1000)),
    }
}
