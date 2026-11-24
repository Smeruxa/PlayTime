import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { io } from "socket.io-client"
import ContentPage from "../../apps/frontend/src/pages/Content"
import MainLayoutPage from "../../apps/frontend/src/pages/MainLayout/MainLayoutPage"
import IncomingCallHandler from "../../apps/frontend/src/utils/IncomingCallHandler"
import { CallContext, SessionContext, socketContextDefaultValue } from "../../apps/frontend/src/server/socketContext/context"
import type { CallProps } from "../../apps/frontend/src/types"
import { callFromState, mergeDirectCall, type DirectCallState } from "../../apps/frontend/src/utils/directCallState"
import "../../apps/frontend/src/index.css"

const userId = Number(new URLSearchParams(location.search).get("user"))
const myName = userId === 1 ? "alex" : "mira"
const peerName = userId === 1 ? "mira" : "alex"
const endpointId = crypto.randomUUID()
const socket = io(location.origin, {
    path: "/qa-call-socket",
    auth: {
        token: (window as unknown as { handoffToken: string }).handoffToken,
        callProtocol: 3,
        peerIdentityProtocol: 1,
        callEndpointId: endpointId
    },
    transports: ["websocket"]
})
const observation = { socket, states: [] as DirectCallState[], activeCall: null as CallProps | null }
Object.assign(window, { callHandoffQa: observation })
socket.on("call:state", (state: DirectCallState) => observation.states.push(state))

function DirectCallHandoffPeer() {
    const [connected, setConnected] = useState(socket.connected)
    const [activeCall, setActiveCall] = useState<CallProps | null>(null)
    const [error, setError] = useState("")
    observation.activeCall = activeCall
    useEffect(() => {
        const connect = () => setConnected(true)
        const disconnect = () => setConnected(false)
        socket.on("connect", connect)
        socket.on("disconnect", disconnect)
        return () => {
            socket.off("connect", connect)
            socket.off("disconnect", disconnect)
        }
    }, [])
    const startCall = () =>
        socket.emit(
            "call:start",
            { username: peerName, peerUserId: userId === 1 ? 2 : 1 },
            (response: {
                success?: boolean
                roomId?: string
                confirmed?: boolean
                state?: DirectCallState
                err?: string
            }) => {
                if (!response.success || !response.roomId) return setError(response.err || "No call acknowledgement")
                setActiveCall((previous) =>
                    mergeDirectCall(
                        previous,
                        (response.state && callFromState(response.state, userId)) || {
                            roomId: response.roomId!,
                            names: [peerName, myName],
                            incoming: false,
                            confirmed: response.confirmed ?? false
                        }
                    )
                )
            }
        )
    return (
        <MemoryRouter initialEntries={["/content"]}>
            <SessionContext.Provider value={{ ...socketContextDefaultValue, socket, myName, myUserId: userId }}>
                <CallContext.Provider value={{ activeCall, setActiveCall }}>
                    <div style={{ position: "fixed", zIndex: 2000, top: 4, left: 80 }}>
                        <button disabled={!connected || activeCall != null} onClick={startCall}>
                            Позвонить {peerName}
                        </button>
                        <output data-testid="signaling">{connected ? "connected" : "disconnected"}</output>
                        {error ? <p role="alert">{error}</p> : null}
                    </div>
                    <IncomingCallHandler />
                    <Routes>
                        <Route element={<MainLayoutPage />}>
                            <Route path="content" element={<ContentPage />} />
                        </Route>
                    </Routes>
                </CallContext.Provider>
            </SessionContext.Provider>
        </MemoryRouter>
    )
}
createRoot(document.getElementById("root")!).render(<DirectCallHandoffPeer />)
