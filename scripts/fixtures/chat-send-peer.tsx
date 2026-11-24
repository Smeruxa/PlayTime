import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { io } from "socket.io-client"
import Chat from "../../apps/frontend/src/components/Chat/Chat"
import { SessionContext, socketContextDefaultValue } from "../../apps/frontend/src/server/socketContext/context"
import { ensureDmKeyPair, profileSetDmPublicKey } from "../../apps/frontend/src/features/chat/dmE2ee"
import "../../apps/frontend/src/index.css"

const userId = Number(new URLSearchParams(location.search).get("user"))
const myName = userId === 1 ? "alex" : "mira"
const peerName = userId === 1 ? "mira" : "alex"
const socket = io(location.origin, {
    path: "/qa-chat-socket",
    auth: { userId },
    transports: ["websocket"]
})
const observation = { socket, ready: false, focusLosses: 0 }
Object.assign(window, { chatSendQa: observation })
document.addEventListener("focusout", (event) => {
    if (event.target instanceof HTMLTextAreaElement) observation.focusLosses++
})

function ChatSendPeer() {
    const [ready, setReady] = useState(false)
    const [open, setOpen] = useState(userId === 1)
    const [error, setError] = useState("")
    useEffect(() => {
        let disposed = false
        const initialize = async () => {
            const publicKey = await ensureDmKeyPair(userId)
            const result = await profileSetDmPublicKey(socket, publicKey)
            if (disposed) return
            if (!result.ok) return setError(result.err || "Key registration failed")
            observation.ready = true
            setReady(true)
        }
        if (socket.connected) void initialize()
        socket.on("connect", initialize)
        return () => {
            disposed = true
            socket.off("connect", initialize)
        }
    }, [])
    return (
        <MemoryRouter>
            <SessionContext.Provider value={{ ...socketContextDefaultValue, socket, myName, myUserId: userId }}>
                <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
                    <header style={{ height: 36, flexShrink: 0 }}>
                        <output data-testid="session-ready">{ready ? "ready" : "initializing"}</output>
                        <button onClick={() => setOpen((value) => !value)}>
                            {open ? "Закрыть тестовый чат" : "Открыть тестовый чат"}
                        </button>
                        {error ? <p role="alert">{error}</p> : null}
                    </header>
                    {ready && open ? <Chat name={peerName} id={userId === 1 ? 2 : 1} is_room={false} /> : null}
                </div>
            </SessionContext.Provider>
        </MemoryRouter>
    )
}
createRoot(document.getElementById("root")!).render(<ChatSendPeer />)
