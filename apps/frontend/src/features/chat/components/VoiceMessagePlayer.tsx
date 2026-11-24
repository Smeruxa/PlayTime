import { useEffect, useState } from "react"
import { API_BASE } from "../../../config"
import { VoiceNoteShell } from "./VoiceNoteShell"
import { mediaBlobForPlayback, type MediaDescriptor } from "../mediaEncryption"

type Props = {
    voiceKey: string
    durationSec: number
    mine: boolean
    media?: MediaDescriptor
}

export function VoiceMessagePlayer({ voiceKey, durationSec, mine, media }: Props) {
    const [url, setUrl] = useState<string | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        let objectUrl: string | null = null
        setFailed(false)
        setUrl(null)

        const run = async () => {
            const token = localStorage.getItem("token")
            if (!token) {
                setFailed(true)
                return
            }
            try {
                const res = await fetch(`${API_BASE}/voice/${encodeURIComponent(voiceKey)}`, {
                    headers: { Authorization: `Bearer ${token}` }
                })
                if (!res.ok) throw new Error("voice fetch")
                const blob = await mediaBlobForPlayback(await res.blob(), "audio/webm", media)
                if (cancelled) return
                objectUrl = URL.createObjectURL(blob)
                setUrl(objectUrl)
            } catch {
                if (!cancelled) setFailed(true)
            }
        }

        void run()
        return () => {
            cancelled = true
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [voiceKey, media])

    return (
        <VoiceNoteShell
            src={failed ? null : url}
            durationHintSec={durationSec}
            variant={mine ? "mine" : "other"}
            pending={!failed && !url}
            error={failed}
        />
    )
}
