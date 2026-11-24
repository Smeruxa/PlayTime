package com.playtimemobile

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.util.UUID

internal class VoiceRecorder(
    private val context: Context,
    private val directory: () -> File,
    private val fileResult: (File) -> WritableMap,
    private val inCall: () -> Boolean,
    private val onLimit: () -> Unit,
    private val async: (Promise, () -> Any?) -> Unit,
) {
    @Volatile private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var limitMs = 120000L
    @Volatile private var limitReached = false
    var onLevel: (Double) -> Unit = {}
    private val meterHandler = Handler(Looper.getMainLooper())
    private var metering = false
    private val meterTick =
        object : Runnable {
            override fun run() = sampleLevel(this)
        }
    val isRecording: Boolean
        get() = recorder != null

    @Synchronized
    fun start(maxSeconds: Double, promise: Promise) {
        if (!maxSeconds.isFinite() || maxSeconds < 1 || maxSeconds > 3600) {
            promise.reject("RECORDING_LIMIT", "Некорректный лимит записи")
            return
        }
        if (
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            promise.reject("MICROPHONE_PERMISSION", "Разрешите доступ к микрофону")
            return
        }
        if (recorder != null || inCall()) {
            promise.reject("MICROPHONE_BUSY", "Микрофон уже используется")
            return
        }
        limitMs = (maxSeconds * 1000).toLong()
        limitReached = false
        try {
            val target = File(directory(), "voice-${UUID.randomUUID()}.m4a")
            val capture =
                if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context)
                else {
                    @Suppress("DEPRECATION") MediaRecorder()
                }
            recorder = capture
            file = target
            capture.setAudioSource(MediaRecorder.AudioSource.MIC)
            capture.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            capture.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            capture.setAudioSamplingRate(48000)
            capture.setAudioEncodingBitRate(96000)
            capture.setOutputFile(target.absolutePath)
            capture.setMaxDuration(limitMs.toInt())
            capture.setOnInfoListener { active, what, _ ->
                if (
                    active === recorder &&
                        what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED
                ) {
                    limitReached = true
                    stopMeter()
                    onLimit()
                }
            }
            capture.prepare()
            capture.start()
            metering = true
            onLevel(0.0)
            meterHandler.postDelayed(meterTick, 100)
            promise.resolve(true)
        } catch (error: Exception) {
            cancel()
            promise.reject("RECORDING_FAILED", "Не удалось начать запись", error)
        }
    }

    @Synchronized
    fun stop(promise: Promise) {
        val capture =
            recorder
                ?: run {
                    promise.reject("NO_RECORDING", "Запись не запущена")
                    return
                }
        val target = checkNotNull(file)
        val maximum = limitMs
        stopMeter()
        try {
            try {
                capture.stop()
            } catch (error: RuntimeException) {
                if (!limitReached) throw error
            }
            capture.release()
            recorder = null
            file = null
            limitReached = false
            async(promise) {
                try {
                    val metadata = MediaMetadataRetriever()
                    val duration =
                        try {
                            metadata.setDataSource(target.absolutePath)
                            metadata
                                .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                                ?.toLongOrNull() ?: 0L
                        } finally {
                            metadata.release()
                        }
                    require(duration >= 300 && target.length() >= 32) { "Запись слишком короткая" }
                    fileResult(target).apply {
                        putDouble("duration", duration.coerceAtMost(maximum).toDouble())
                        putDouble("durationMs", duration.coerceAtMost(maximum).toDouble())
                    }
                } catch (error: Exception) {
                    target.delete()
                    throw error
                }
            }
        } catch (error: Exception) {
            cancel()
            target.delete()
            promise.reject(
                "RECORDING_FAILED",
                "Запись слишком короткая или микрофон недоступен",
                error,
            )
        }
    }

    @Synchronized
    fun cancel() {
        stopMeter()
        runCatching { recorder?.stop() }
        runCatching { recorder?.release() }
        recorder = null
        file?.delete()
        file = null
        limitReached = false
    }

    @Synchronized
    private fun sampleLevel(tick: Runnable) {
        val capture = recorder
        if (!metering || capture == null || limitReached) return
        val amplitude = runCatching { capture.maxAmplitude }.getOrDefault(0)
        onLevel(normalizedLevel(amplitude))
        if (metering) meterHandler.postDelayed(tick, 100)
    }

    @Synchronized
    private fun stopMeter() {
        val wasMetering = metering
        metering = false
        meterHandler.removeCallbacks(meterTick)
        if (wasMetering) onLevel(0.0)
    }

    companion object {
        internal fun normalizedLevel(amplitude: Int): Double =
            amplitude.coerceIn(0, 32767) / 32767.0
    }
}
