import { useEffect, useState, type RefObject } from "react"
import type { Socket } from "socket.io-client"
import type { VoiceMesh } from "../../../webrtc"
import type { CallDiagnostics } from "../../../webrtc/diagnostics"
import { Modal } from "../../../ui/overlays/Modal"
import { Button } from "../../../ui"
import styles from "./CallDiagnosticsModal.module.css"

export function CallDiagnosticsModal({ meshRef, socket, onClose }: { meshRef: RefObject<VoiceMesh | null>; socket: Socket | null; onClose: () => void }) {
    const [report, setReport] = useState<CallDiagnostics | null>(null)
    const [connected, setConnected] = useState(!!socket?.connected)
    const [message, setMessage] = useState("")
    useEffect(() => {
        let cancelled = false, running = false
        const poll = async () => {
            if (running) return
            running = true
            try {
                const next = await meshRef.current?.getDiagnostics()
                if (!cancelled) { setReport(next || null); setConnected(!!socket?.connected) }
            } finally { running = false }
        }
        void poll(); const timer = setInterval(() => void poll(), 2000)
        return () => { cancelled = true; clearInterval(timer) }
    }, [meshRef, socket])
    const save = () => {
        if (!report) return
        const sanitized = { ...report, microphone: { available: report.microphone.available, enabled: report.microphone.enabled }, signalingConnected: connected }
        const url = URL.createObjectURL(new Blob([JSON.stringify(sanitized, null, 2)], { type: "application/json" }))
        const link = document.createElement("a"); link.href = url; link.download = "playtime-call-diagnostics.json"; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }
    return <Modal title="Качество связи" onClose={onClose}>
        <div className={styles.body}>
            <dl className={styles.summary}>
                <dt>Соединение с сервером</dt><dd>{connected ? "Подключено" : "Переподключение…"}</dd>
                <dt>Микрофон</dt><dd>{report?.microphone.available ? report.microphone.enabled ? "Работает" : "Выключен" : "Недоступен"}</dd>
                <dt>Устройство</dt><dd>{report?.microphone.device || "Ожидаем доступ к микрофону"}</dd>
                <dt>Попытки восстановления</dt><dd>{report?.reconnectAttempts ?? 0}</dd>
            </dl>
            {report?.peers.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Голосовой канал</th><th>Маршрут</th><th>Задержка</th><th>Потери за звонок</th><th>Джиттер</th></tr></thead><tbody>{report.peers.map((peer,index) => <tr key={index}>
                <td>{index + 1} · {peer.connection === "connected" ? "Подключён" : peer.connection === "failed" ? "Ошибка" : "Подключение…"}</td><td>{peer.relay == null ? "Определяем…" : peer.relay ? "Через сервер" : "Напрямую"} · {peer.transport}</td>
                <td>{peer.rttMs == null ? "—" : `${peer.rttMs} мс`}</td><td>{peer.lostPercent == null ? "—" : `${peer.lostPercent}%`}</td><td>{peer.jitterMs == null ? "—" : `${peer.jitterMs} мс`}</td>
            </tr>)}</tbody></table></div> : <p role="status">Голосовые соединения ещё не установлены.</p>}
            <p className={styles.hint}>Если микрофон недоступен, проверьте разрешение PlayTime в настройках системы и выбранное устройство. Экспорт содержит показатели соединения без адресов, имён и содержимого звонка.</p>
            <Button variant="secondary" disabled={!report} onClick={save}>Сохранить диагностику</Button>
            <Button variant="ghost" disabled={!connected || !report?.peers.length} onClick={() => { meshRef.current?.reconnect(); setMessage("Восстанавливаем голосовое соединение…") }}>Переподключить голос</Button>
            {message && <p role="status" className={styles.hint}>{message}</p>}
        </div>
    </Modal>
}
