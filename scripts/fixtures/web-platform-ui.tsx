import { useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import type { Socket } from "socket.io-client"
import { SessionContext, socketContextDefaultValue } from "../../apps/frontend/src/server/socketContext/context"
import SettingsModal from "../../apps/frontend/src/components/SettingsModal/SettingsModal"
import ScreenShareModal from "../../apps/frontend/src/pages/Talk/Remake/ScreenShareModal"
import Talk from "../../apps/frontend/src/pages/Talk/Remake/Talk"
import { captureScreenShare } from "../../apps/frontend/src/webrtc/screenCapture"
import "../../apps/frontend/src/index.css"

Object.assign(window, { platformCaptureProbe: () => captureScreenShare(false) })

const handlers = new Map<string, Set<(...args: any[]) => void>>()
const socket = {
    connected: true,
    on(name: string, handler: (...args: any[]) => void) {
        if (!handlers.has(name)) handlers.set(name, new Set())
        handlers.get(name)!.add(handler)
        return this
    },
    off(name: string, handler: (...args: any[]) => void) {
        handlers.get(name)?.delete(handler)
        return this
    },
    emit(name: string, data?: any, callback?: (response: any) => void) {
        if (name === "webrtc:config:request") queueMicrotask(() => {
            handlers.get("webrtc:config")?.forEach(handler => handler({ iceServers: [{ urls: "stun:127.0.0.1" }] }))
        })
        if (name === "profile:friendsAvatars") queueMicrotask(() => callback?.({}))
        if (name === "profile:get") queueMicrotask(() => callback?.({ profile: { username: data?.username } }))
        return this
    },
    timeout() { return this }
} as unknown as Socket

function Preview() {
    const [visible, setVisible] = useState(true)
    const surface = new URLSearchParams(location.search).get("surface")
    return (
        <MemoryRouter>
            <SessionContext.Provider value={{ ...socketContextDefaultValue, socket, myName: "alex", myUserId: 1 }}>
                <main style={{ width: "100%", maxWidth: 880, margin: "48px auto", padding: 20 }}>
                    <h1 style={{ fontSize: 24, marginBottom: 24 }}>PlayTime</h1>
                    {surface === "call" ? <Talk call={{ names: ["mira", "alex"], roomId: "2:1", incoming: true, confirmed: true }} setShow={() => {}} /> : null}
                    {visible && surface === "screen" ? <ScreenShareModal onSelect={stream => { stream.getTracks().forEach(track => track.stop()); setVisible(false) }} onClose={() => setVisible(false)} /> : null}
                    {visible && surface === "settings" ? <SettingsModal onClose={() => setVisible(false)} /> : null}
                </main>
            </SessionContext.Provider>
        </MemoryRouter>
    )
}
createRoot(document.getElementById("root")!).render(<Preview />)
