import { useEffect, useState } from "react"
import { keyFingerprint, trustPeerKey } from "../peerKeyTrust"
import { useSessionSocket } from "../../../server/socketContext"
import { Button } from "../../../ui"

type Change = { userId: number | null; peer: string; displayName?: string; previous: string; key: string }
export function PeerKeyNotice() {
    const { myUserId } = useSessionSocket()
    const [change, setChange] = useState<Change | null>(null)
    const [fingerprint, setFingerprint] = useState("")
    useEffect(() => {
        setChange(null)
        setFingerprint("")
    }, [myUserId])
    useEffect(() => {
        const onChange = (event: Event) => setChange((event as CustomEvent<Change>).detail)
        window.addEventListener("playtime:peer-key-changed", onChange)
        return () => window.removeEventListener("playtime:peer-key-changed", onChange)
    }, [])
    useEffect(() => {
        let active = true
        setFingerprint("")
        if (change && change.userId === myUserId)
            void keyFingerprint(change.key)
                .then((value) => {
                    if (active) setFingerprint(value)
                })
                .catch(() => {})
        return () => {
            active = false
        }
    }, [change, myUserId])
    if (!change || change.userId !== myUserId) return null
    return (
        <aside
            role="alert"
            style={{ background: "#342a13", color: "#ffe3a0", padding: "14px 20px", fontSize: 13, lineHeight: 1.6 }}
        >
            <strong>У {change.displayName ?? change.peer} изменился ключ переписки.</strong> Это возможно после
            переустановки приложения. Перед отправкой сравните отпечаток с собеседником по другому каналу.
            <code style={{ display: "block", overflowWrap: "anywhere", margin: "8px 0" }}>{fingerprint}</code>
            <Button
                variant="secondary"
                onClick={() => {
                    trustPeerKey(change.peer, change.key, change.userId)
                    setChange(null)
                }}
            >
                Подтверждаю новый ключ
            </Button>
        </aside>
    )
}
