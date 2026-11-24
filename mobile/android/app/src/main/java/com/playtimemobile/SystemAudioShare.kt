package com.playtimemobile

import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.oney.WebRTCModule.WebRTCModule
import org.webrtc.AudioTrack
import org.webrtc.PlayTimeAudioTrackBridge

internal class SystemAudioShare(
    private val context: ReactApplicationContext,
    private val onError: (String) -> Unit,
) {
    private var screenRelay: AudioCaptureRelay? = null
    private var microphoneRelay: AudioCaptureRelay? = null
    private var screenInfo: WritableMap? = null
    private var microphoneInfo: WritableMap? = null
    private var pending: Promise? = null
    private var projection: MediaProjection? = null
    private var owner: WebRTCModule? = null
    private val localTrackIds = mutableListOf<String>()
    private val handler = Handler(Looper.getMainLooper())
    private var generation = 0L
    private var timeout: Runnable? = null
    private var projectionCallback: MediaProjection.Callback? = null

    fun start(videoTrackId: String, promise: Promise) {
        if (Build.VERSION.SDK_INT < 29) {
            promise.reject(
                "SYSTEM_AUDIO_UNSUPPORTED",
                "Звук приложений доступен на Android 10 и новее",
            )
            return
        }
        WebRTCModule.playTimeExecute {
            if (screenRelay != null || microphoneRelay != null || pending != null) {
                promise.reject("SYSTEM_AUDIO_BUSY", "Системный звук уже включён")
                return@playTimeExecute
            }
            generation += 1
            val attempt = generation
            try {
                val webRtc = checkNotNull(context.getNativeModule(WebRTCModule::class.java))
                owner = webRtc
                check(!webRtc.playTimeAutomaticAudioRecordingEnabled()) {
                    "Сначала переключите основной звонок на независимые аудиодорожки"
                }
                val consent =
                    webRtc.playTimeScreenProjection(videoTrackId)
                        ?: error("Сначала разрешите демонстрацию экрана")
                pending = promise
                projection = consent
                val callback =
                    object : MediaProjection.Callback() {
                        override fun onStop() {
                            WebRTCModule.playTimeExecute {
                                if (generation == attempt) fail("Демонстрация экрана завершена")
                            }
                        }
                    }
                projectionCallback = callback
                consent.registerCallback(callback, handler)
                microphoneRelay =
                    AudioCaptureRelay(
                        context,
                        null,
                        { remote ->
                            if (generation == attempt) {
                                microphoneInfo =
                                    registerTrack(webRtc, remote, "playtime-microphone")
                                completeIfReady()
                            }
                        },
                        { message -> if (generation == attempt) fail(message) },
                    )
                screenRelay =
                    AudioCaptureRelay(
                        context,
                        consent,
                        { remote ->
                            if (generation == attempt) {
                                screenInfo = registerTrack(webRtc, remote, "playtime-system-audio")
                                completeIfReady()
                            }
                        },
                        { message -> if (generation == attempt) fail(message) },
                    )
                val deadline = Runnable {
                    WebRTCModule.playTimeExecute {
                        if (generation == attempt)
                            fail("Системный звук не удалось включить. Попробуйте снова.")
                    }
                }
                timeout = deadline
                handler.postDelayed(deadline, 15000)
                microphoneRelay?.start()
                screenRelay?.start()
            } catch (error: Exception) {
                if (pending == promise) pending = null
                stopInternal()
                promise.reject(
                    "SYSTEM_AUDIO_FAILED",
                    error.message ?: "Не удалось включить звук приложений",
                    error,
                )
            }
        }
    }

    private fun registerTrack(
        webRtc: WebRTCModule,
        remote: AudioTrack,
        device: String,
    ): WritableMap {
        val forwarded = PlayTimeAudioTrackBridge.retain(remote)
        webRtc.playTimeRegisterAudioTrack(forwarded)
        localTrackIds.add(forwarded.id())
        return Arguments.createMap().apply {
            putString("id", forwarded.id())
            putString("kind", "audio")
            putBoolean("enabled", true)
            putBoolean("remote", false)
            putString("readyState", "live")
            putInt("peerConnectionId", -1)
            putMap("constraints", Arguments.createMap())
            putMap("settings", Arguments.createMap().apply { putString("deviceId", device) })
        }
    }

    private fun completeIfReady() {
        val screen = screenInfo ?: return
        val microphone = microphoneInfo ?: return
        val waiting = pending ?: return
        timeout?.let { handler.removeCallbacks(it) }
        timeout = null
        pending = null
        waiting.resolve(
            Arguments.createMap().apply {
                putMap("screenInfo", screen)
                putMap("microphoneInfo", microphone)
            }
        )
    }

    private fun fail(message: String) {
        val waiting = pending
        pending = null
        if (waiting != null) {
            stopInternal()
            waiting.reject("SYSTEM_AUDIO_FAILED", message)
        } else {
            generation += 1
            timeout?.let { handler.removeCallbacks(it) }
            timeout = null
            if (Build.VERSION.SDK_INT >= 29) {
                screenRelay?.suspendCapture()
                microphoneRelay?.suspendCapture()
            }
            onError(message)
        }
    }

    fun stop(promise: Promise? = null) {
        WebRTCModule.playTimeExecute {
            stopInternal()
            promise?.resolve(true)
        }
    }

    private fun stopInternal() {
        generation += 1
        timeout?.let { handler.removeCallbacks(it) }
        timeout = null
        pending?.reject("SYSTEM_AUDIO_CANCELED", "Включение системного звука отменено")
        pending = null
        projectionCallback?.let { projection?.unregisterCallback(it) }
        projectionCallback = null
        projection = null
        val webRtc = owner
        owner = null
        localTrackIds.forEach { webRtc?.playTimeDisposeAudioTrack(it) }
        localTrackIds.clear()
        screenInfo = null
        microphoneInfo = null
        if (Build.VERSION.SDK_INT >= 29) {
            screenRelay?.close()
            microphoneRelay?.close()
        }
        screenRelay = null
        microphoneRelay = null
    }
}
