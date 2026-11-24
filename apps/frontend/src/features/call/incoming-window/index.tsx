import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import "../../../index.css"
import type { IncomingCallWindowState } from "../incomingCallWindowTypes"
import { IncomingCallWindow } from "./IncomingCallWindow"

function IncomingCallApp() {
    const api = window.incomingCallAPI
    const [call, setCall] = useState<IncomingCallWindowState | null>(null)

    useEffect(() => api?.onUpdate(setCall), [api])

    if (!api || !call) return null

    const answer = (accept: boolean) => {
        if (call.busy) return
        setCall({ ...call, busy: true, error: null })
        api.answer({ roomId: call.roomId, accept })
    }

    return <IncomingCallWindow key={call.roomId} call={call} onAnswer={answer} />
}

createRoot(document.getElementById("root")!).render(<IncomingCallApp />)
