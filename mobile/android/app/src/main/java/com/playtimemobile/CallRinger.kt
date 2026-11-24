package com.playtimemobile

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator

internal class CallRinger(private val context: Context) {
    private var ringtone: Ringtone? = null
    private var ringback: MediaPlayer? = null
    @Suppress("DEPRECATION")
    private val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator

    fun start(incoming: Boolean) {
        stop()
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (audio.ringerMode == AudioManager.RINGER_MODE_SILENT) return
        if (incoming) {
            if (audio.ringerMode == AudioManager.RINGER_MODE_NORMAL) {
                ringtone =
                    RingtoneManager.getRingtone(
                            context,
                            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                        )
                        .apply {
                            audioAttributes =
                                AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                                    .build()
                            if (Build.VERSION.SDK_INT >= 28) isLooping = true
                            play()
                        }
            }
            if (vibrator.hasVibrator()) {
                val pattern = longArrayOf(0, 500, 1000)
                if (Build.VERSION.SDK_INT >= 26)
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0))
                else legacyVibrate(pattern)
            }
        } else if (audio.ringerMode == AudioManager.RINGER_MODE_NORMAL) {
            val player = MediaPlayer()
            context.assets.openFd("sounds/call.mp3").use {
                player.setDataSource(it.fileDescriptor, it.startOffset, it.length)
            }
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING)
                    .build()
            )
            player.isLooping = true
            player.setVolume(0.35f, 0.35f)
            player.prepare()
            player.start()
            ringback = player
        }
    }

    @Suppress("DEPRECATION")
    private fun legacyVibrate(pattern: LongArray) {
        vibrator.vibrate(pattern, 0)
    }

    fun stop() {
        ringtone?.stop()
        ringtone = null
        ringback?.release()
        ringback = null
        vibrator.cancel()
    }
}
