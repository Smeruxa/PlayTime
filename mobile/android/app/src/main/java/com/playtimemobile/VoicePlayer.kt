package com.playtimemobile

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap

internal class VoicePlayer(
    private val context: Context,
    private val inCall: () -> Boolean,
    private val onEnded: (String?) -> Unit,
    private val onPaused: () -> Unit,
) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var player: MediaPlayer? = null
    private var prepared = false
    private var pending: Promise? = null
    private var focus: AudioFocusRequest? = null
    private var hasLegacyFocus = false
    private val attributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change != AudioManager.AUDIOFOCUS_GAIN) interrupt()
    }

    @Synchronized
    private fun interrupt() {
        val waiting = pending
        if (waiting != null) {
            pending = null
            stop()
            waiting.reject("PLAYBACK_INTERRUPTED", "Воспроизведение прервано другим приложением")
            onEnded("Воспроизведение прервано другим приложением")
        } else {
            runCatching { if (prepared && player?.isPlaying == true) player?.pause() }
            releaseFocus()
            onPaused()
        }
    }

    @Suppress("DEPRECATION")
    private fun requestFocus(): Boolean {
        if (inCall()) return true
        val result =
            if (Build.VERSION.SDK_INT >= 26) {
                val request =
                    AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                        .setAudioAttributes(attributes)
                        .setOnAudioFocusChangeListener(focusListener)
                        .build()
                focus = request
                audio.requestAudioFocus(request)
            } else {
                hasLegacyFocus = true
                audio.requestAudioFocus(
                    focusListener,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
                )
            }
        return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    @Suppress("DEPRECATION")
    private fun releaseFocus() {
        val request = focus
        focus = null
        if (Build.VERSION.SDK_INT >= 26 && request != null) audio.abandonAudioFocusRequest(request)
        if (hasLegacyFocus) {
            hasLegacyFocus = false
            audio.abandonAudioFocus(focusListener)
        }
    }

    @Synchronized
    fun play(uri: String, promise: Promise) {
        stop()
        pending = promise
        try {
            check(requestFocus()) { "Другое приложение использует звук" }
            val playback = MediaPlayer()
            player = playback
            playback.setAudioAttributes(attributes)
            playback.setDataSource(context, Uri.parse(uri))
            playback.setOnPreparedListener { prepared(it) }
            playback.setOnCompletionListener { completed(it) }
            playback.setOnErrorListener { errored, _, _ ->
                failed(errored)
                true
            }
            playback.prepareAsync()
        } catch (error: Exception) {
            pending = null
            stop()
            promise.reject(
                "PLAYBACK_FAILED",
                error.message ?: "Не удалось воспроизвести запись",
                error,
            )
        }
    }

    @Synchronized
    private fun prepared(playback: MediaPlayer) {
        if (player !== playback) return
        val waiting = pending
        pending = null
        try {
            prepared = true
            playback.start()
            waiting?.resolve(true)
        } catch (error: Exception) {
            stop()
            waiting?.reject("PLAYBACK_FAILED", "Не удалось воспроизвести запись", error)
            onEnded("Не удалось воспроизвести запись")
        }
    }

    @Synchronized
    private fun completed(playback: MediaPlayer) {
        if (player !== playback) return
        releaseFocus()
        onEnded(null)
    }

    @Synchronized
    private fun failed(playback: MediaPlayer) {
        if (player !== playback) return
        val waiting = pending
        pending = null
        stop()
        waiting?.reject("PLAYBACK_FAILED", "Не удалось воспроизвести запись")
        onEnded("Не удалось воспроизвести запись")
    }

    @Synchronized
    fun pause(): Boolean {
        if (!prepared) return false
        player?.pause()
        releaseFocus()
        return true
    }

    @Synchronized
    fun resume(): Boolean {
        if (!prepared || player == null || !requestFocus()) return false
        player?.start()
        return true
    }

    @Suppress("DEPRECATION")
    @Synchronized
    fun seek(positionMs: Double): Boolean {
        if (!prepared || !positionMs.isFinite()) return false
        val playback = player ?: return false
        val position = positionMs.coerceIn(0.0, playback.duration.toDouble()).toLong()
        if (Build.VERSION.SDK_INT >= 26) playback.seekTo(position, MediaPlayer.SEEK_CLOSEST)
        else playback.seekTo(position.toInt())
        return true
    }

    @Synchronized
    fun progress(): WritableMap =
        Arguments.createMap().apply {
            putDouble(
                "positionMs",
                if (prepared) (player?.currentPosition ?: 0).toDouble() else 0.0,
            )
            putDouble("durationMs", if (prepared) (player?.duration ?: 0).toDouble() else 0.0)
            putBoolean("playing", prepared && player?.isPlaying == true)
        }

    @Synchronized
    fun stop() {
        prepared = false
        val playback = player
        player = null
        playback?.release()
        releaseFocus()
        pending?.resolve(false)
        pending = null
    }
}
