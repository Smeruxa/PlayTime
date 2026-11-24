import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom"
import { io } from "socket.io-client"
import Chat from "../../apps/frontend/src/components/Chat/Chat"
import FriendsPage from "../../apps/frontend/src/pages/Friends/FriendsPage"
import { SessionContext, socketContextDefaultValue } from "../../apps/frontend/src/server/socketContext/context"
import { ensureDmKeyPair, profileSetDmPublicKey } from "../../apps/frontend/src/features/chat/dmE2ee"
import type { FriendItem } from "../../apps/frontend/src/pages/Friends/types"
import "../../apps/frontend/src/index.css"

type Session = { token: string; user: { id: number; username: string } }
async function main() {
    const query = new URLSearchParams(location.search)
    const session: Session = await (await fetch(`/__qa-session?user=${query.get("user")}`)).json()
    const socket = io(location.origin, {
        path: "/qa-guest-socket",
        auth: { token: session.token, peerIdentityProtocol: 1, callProtocol: 2 },
        transports: ["websocket"]
    })
    const observation = { socket, userId: session.user.id, received: [] as number[] }
    socket.on("message:receive", (message: { id: number }) => observation.received.push(message.id))
    Object.assign(window, { guestNicknameQa: observation })
    function Peer() {
        const [ready, setReady] = useState(false)
        const [friends, setFriends] = useState<FriendItem[]>([])
        const [error, setError] = useState("")
        const route = useLocation()
        const navigate = useNavigate()
        const selected = route.state as { peerUserId?: number; name?: string } | null
        const peerId = selected?.peerUserId ?? Number(query.get("peer"))
        const peer = friends.find((friend) => friend.other_user_id === peerId)
        useEffect(() => {
            const refresh = () => socket.emit("friend:list", {}, (rows: FriendItem[]) => setFriends(rows))
            const initialize = async () => {
                const result = await profileSetDmPublicKey(socket, await ensureDmKeyPair(session.user.id))
                if (!result.ok) return setError(result.err || "Key publication failed")
                refresh()
                setReady(true)
            }
            socket.on("friend:list:updated", refresh)
            socket.on("connect", initialize)
            if (socket.connected) void initialize()
            return () => {
                socket.off("friend:list:updated", refresh)
                socket.off("connect", initialize)
            }
        }, [])
        return (
            <SessionContext.Provider
                value={{
                    ...socketContextDefaultValue,
                    socket,
                    myName: session.user.username,
                    myUserId: session.user.id
                }}
            >
                <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
                    <header style={{ flexShrink: 0 }}>
                        <output data-testid="session-ready">{ready ? "ready" : "initializing"}</output>
                        <button onClick={() => navigate("/friends")}>Контакты QA</button>
                        <button
                            onClick={() => socket.emit("friend:list", {}, (rows: FriendItem[]) => setFriends(rows))}
                        >
                            Обновить контакты QA
                        </button>
                        <output data-testid="selected-peer-id">
                            {route.pathname === "/friends" ? "contacts" : peerId}
                        </output>
                        <output data-testid="friend-identities" style={{ display: "none" }}>
                            {JSON.stringify(friends)}
                        </output>
                        {error && <p role="alert">{error}</p>}
                    </header>
                    {ready &&
                        (route.pathname === "/friends" ? (
                            <FriendsPage />
                        ) : (
                            peer && (
                                <Chat
                                    key={peerId}
                                    id={peerId}
                                    name={peer.friend_username}
                                    is_room={false}
                                    archived={peer.friend_archived}
                                />
                            )
                        ))}
                </div>
            </SessionContext.Provider>
        )
    }
    createRoot(document.getElementById("root")!).render(
        <MemoryRouter initialEntries={["/content"]}>
            <Peer />
        </MemoryRouter>
    )
}
void main()
