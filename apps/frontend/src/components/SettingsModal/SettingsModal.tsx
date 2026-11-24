import { useCallback, useEffect, useRef, useState } from "react"
import { useCallState } from "../../server/socketContext"
import { getStoredInputDeviceId, setStoredInputDeviceId } from "../../audioDeviceStorage"
import { MIC_CAPTURE_AUDIO } from "../../webrtc/micStream"
import { Modal } from "../../ui/overlays/Modal"
import { Button } from "../../ui/primitives/Button"
import { Select } from "../../ui/primitives/Select"
import { browserNotificationPermission, requestBrowserNotifications } from "../../platform/notifications"
import { microphoneError } from "../../platform/mediaErrors"
import styles from "./SettingsModal.module.css"

type Props = {
    onClose: () => void
}

export default function SettingsModal({ onClose }: Props) {
    const { activeCall } = useCallState()
    const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
    const [inputId, setInputId] = useState(() => getStoredInputDeviceId() ?? "")
    const [permErr, setPermErr] = useState<string | null>(null)
    const [meter, setMeter] = useState(0)
    const [notificationPermission, setNotificationPermission] = useState(browserNotificationPermission)
    const [requestingNotifications, setRequestingNotifications] = useState(false)
    const micRequestRef = useRef(0)
    const testStreamRef = useRef<MediaStream | null>(null)
    const testAudioCtxRef = useRef<AudioContext | null>(null)
    const testAnalyserRef = useRef<AnalyserNode | null>(null)
    const rafRef = useRef<number | null>(null)

    const loadDeviceLists = useCallback(async () => {
        try {
            const list = await navigator.mediaDevices.enumerateDevices()
            setInputs(list.filter((d) => d.kind === "audioinput"))
        } catch {
            setInputs([])
        }
    }, [])

    const refreshDevices = useCallback(async () => {
        setPermErr(null)
        await loadDeviceLists()
    }, [loadDeviceLists])

    useEffect(() => {
        refreshDevices()
        const onChange = () => {
            refreshDevices()
        }
        navigator.mediaDevices?.addEventListener?.("devicechange", onChange)
        return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange)
    }, [refreshDevices])

    const stopMicTest = useCallback(() => {
        micRequestRef.current++
        if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
        testStreamRef.current?.getTracks().forEach((t) => t.stop())
        testStreamRef.current = null
        const ctx = testAudioCtxRef.current
        testAudioCtxRef.current = null
        testAnalyserRef.current = null
        if (ctx && ctx.state !== "closed") ctx.close().catch(() => {})
        setMeter(0)
    }, [])

    useEffect(() => () => stopMicTest(), [stopMicTest])

    const runMeterLoop = () => {
        const analyser = testAnalyserRef.current
        if (!analyser) return
        const buf = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
            analyser.getByteFrequencyData(buf)
            let sum = 0
            for (let i = 0; i < buf.length; i++) sum += buf[i]
            const avg = buf.length ? sum / buf.length / 255 : 0
            setMeter(Math.min(1, avg * 2.2))
            rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
    }

    const startMicTest = async () => {
        if (activeCall) return
        stopMicTest()
        setPermErr(null)
        const request = micRequestRef.current
        const dev = inputId || undefined
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: dev ? { ...MIC_CAPTURE_AUDIO, deviceId: { ideal: dev } } : MIC_CAPTURE_AUDIO
            })
            if (request !== micRequestRef.current) {
                stream.getTracks().forEach((track) => track.stop())
                return
            }
            testStreamRef.current = stream
            const ctx = new AudioContext()
            testAudioCtxRef.current = ctx
            if (ctx.state === "suspended") void ctx.resume().catch(() => {})
            const src = ctx.createMediaStreamSource(stream)
            const analyser = ctx.createAnalyser()
            analyser.fftSize = 512
            analyser.smoothingTimeConstant = 0.65
            src.connect(analyser)
            testAnalyserRef.current = analyser
            runMeterLoop()
            void loadDeviceLists()
        } catch (error) {
            if (request !== micRequestRef.current) return
            stopMicTest()
            setPermErr(microphoneError(error))
        }
    }

    const onInputChange = (v: string) => {
        setInputId(v)
        setStoredInputDeviceId(v)
    }

    return (
        <Modal
            title="Настройки"
            onClose={onClose}
            footer={
                <Button variant="secondary" onClick={onClose}>
                    Закрыть
                </Button>
            }
        >
            {permErr ? (
                <p role="alert" className={styles.err}>
                    {permErr}
                </p>
            ) : null}

            <div className={styles.field}>
                <label className={styles.label} htmlFor="pt-audio-in">
                    Микрофон
                </label>
                <Select
                    id="pt-audio-in"
                    value={inputId}
                    onChange={onInputChange}
                    placeholder="По умолчанию"
                    options={[
                        { value: "", label: "По умолчанию" },
                        ...inputs
                            .filter((device) => device.deviceId)
                            .map((device) => ({
                                value: device.deviceId,
                                label: device.label || `Микрофон ${device.deviceId.slice(0, 8)}…`
                            }))
                    ]}
                />
            </div>

            <div className={styles.field}>
                <span className={styles.label}>Проверка микрофона</span>
                <div className={styles.testRow}>
                    <button
                        type="button"
                        className={styles.testBtn}
                        disabled={!!activeCall}
                        title={activeCall ? "Недоступно во время звонка" : "Удерживайте для индикации уровня"}
                        onPointerDown={(e) => {
                            e.preventDefault()
                            if (activeCall) return
                            startMicTest()
                        }}
                        onPointerUp={() => stopMicTest()}
                        onPointerLeave={() => stopMicTest()}
                        onPointerCancel={() => stopMicTest()}
                        onKeyDown={(e) => {
                            if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                                e.preventDefault()
                                void startMicTest()
                            }
                        }}
                        onKeyUp={(e) => {
                            if (e.key === " " || e.key === "Enter") {
                                e.preventDefault()
                                stopMicTest()
                            }
                        }}
                        onBlur={stopMicTest}
                    >
                        Удержать — уровень
                    </button>
                </div>
                <div className={styles.meterWrap} aria-hidden>
                    <div className={styles.meterFill} style={{ width: `${Math.round(meter * 100)}%` }} />
                </div>
            </div>
            {!window.electronAPI && (
                <div className={styles.field}>
                    <span className={styles.label}>Уведомления</span>
                    <p className={styles.hint} role="status">
                        {notificationPermission === "granted"
                            ? "Уведомления включены. Не закрывайте вкладку, чтобы получать сообщения."
                            : notificationPermission === "denied"
                              ? "Уведомления отключены в браузере. Разрешите их в настройках этого сайта."
                              : notificationPermission === "unsupported"
                                ? "Системные уведомления недоступны в этом браузере. Новые сообщения появятся в приложении."
                                : "Узнавайте о новых сообщениях, когда переключаетесь на другую вкладку."}
                    </p>
                    {notificationPermission === "default" && (
                        <Button
                            variant="secondary"
                            disabled={requestingNotifications}
                            onClick={async () => {
                                setRequestingNotifications(true)
                                setNotificationPermission(await requestBrowserNotifications())
                                setRequestingNotifications(false)
                            }}
                        >
                            {requestingNotifications ? "Ожидание разрешения…" : "Включить уведомления"}
                        </Button>
                    )}
                </div>
            )}
        </Modal>
    )
}
