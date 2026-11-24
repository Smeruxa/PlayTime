import { useEffect, useState } from "react"

export type UpdateState =
    | { kind: "idle" }
    | { kind: "available"; version: string; percent?: number }
    | { kind: "preparing" | "downloaded" | "installing" | "manual"; version: string }
    | { kind: "error"; version?: string | null; message: string }

export function useAppUpdate() {
    const [state, setState] = useState<UpdateState>({ kind: "idle" })

    useEffect(() => {
        const api = window.electronAPI
        if (!api?.onUpdateEvent) return undefined

        let active = true
        let receivedEvent = false
        const unsub = api.onUpdateEvent((channel, payload) => {
            if (channel !== "update:state" || !active) return
            receivedEvent = true
            setState(payload as UpdateState)
        })
        api.getUpdateState?.().then(
            (snapshot) => {
                if (active && !receivedEvent) setState(snapshot)
            },
            () => {}
        )
        return () => {
            active = false
            unsub()
        }
    }, [])

    const run = async (action: (() => Promise<{ error?: string } | void>) | undefined) => {
        if (!action) return
        try {
            const result = await action()
            if (result?.error)
                setState({ kind: "error", message: result.error, version: "version" in state ? state.version : null })
        } catch {
            setState({
                kind: "error",
                message: "Не удалось запустить обновление.",
                version: "version" in state ? state.version : null
            })
        }
    }

    return {
        state,
        install: () => run(window.electronAPI?.installUpdate),
        openDownload: () => run(window.electronAPI?.openUpdateDownload),
        retry: () => run(window.electronAPI?.checkForUpdates)
    }
}
