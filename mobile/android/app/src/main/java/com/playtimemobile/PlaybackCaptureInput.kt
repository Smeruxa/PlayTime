package com.playtimemobile

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Process
import androidx.annotation.RequiresApi
import org.webrtc.audio.JavaAudioDeviceModule

@RequiresApi(29)
internal class PlaybackCaptureInput(
    context: Context,
    projection: MediaProjection,
    onReady: () -> Unit,
    onError: (String) -> Unit,
) : RelayAudioInput {
    override val module: JavaAudioDeviceModule
    private val recordField =
        Class.forName("org.webrtc.audio.WebRtcAudioRecord").getDeclaredField("audioRecord").apply {
            isAccessible = true
        }
    private val inputField =
        JavaAudioDeviceModule::class.java.getDeclaredField("audioInput").apply {
            isAccessible = true
        }

    init {
        val captureConfiguration =
            AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .excludeUid(Process.myUid())
                .build()
        val format =
            AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(48000)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build()
        module =
            JavaAudioDeviceModule.builder(context)
                .setInputSampleRate(48000)
                .setUseStereoInput(true)
                .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                .setUseHardwareAcousticEchoCanceler(false)
                .setUseHardwareNoiseSuppressor(false)
                .setAudioRecordStateCallback(
                    object : JavaAudioDeviceModule.AudioRecordStateCallback {
                        override fun onWebRtcAudioRecordStart() {
                            var replacement: AudioRecord? = null
                            try {
                                if (
                                    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) !=
                                        PackageManager.PERMISSION_GRANTED
                                ) {
                                    throw SecurityException("Нет разрешения на захват звука")
                                }
                                val input = inputField.get(module)
                                val original =
                                    recordField.get(input) as? AudioRecord
                                        ?: error("WebRTC input unavailable")
                                check(original.sampleRate == 48000 && original.channelCount == 2) {
                                    "Unexpected WebRTC audio format"
                                }
                                val minimum =
                                    AudioRecord.getMinBufferSize(
                                        48000,
                                        AudioFormat.CHANNEL_IN_STEREO,
                                        AudioFormat.ENCODING_PCM_16BIT,
                                    )
                                check(minimum > 0) { "Stereo playback capture is unavailable" }
                                replacement =
                                    AudioRecord.Builder()
                                        .setAudioPlaybackCaptureConfig(captureConfiguration)
                                        .setAudioFormat(format)
                                        .setBufferSizeInBytes(maxOf(minimum * 2, 7680))
                                        .build()
                                check(replacement.state == AudioRecord.STATE_INITIALIZED) {
                                    "Playback capture did not initialize"
                                }
                                replacement.startRecording()
                                check(
                                    replacement.recordingState == AudioRecord.RECORDSTATE_RECORDING
                                )
                                recordField.set(input, replacement)
                                replacement = null
                                original.stop()
                                original.release()
                                module.setMicrophoneMute(false)
                                onReady()
                            } catch (error: Exception) {
                                runCatching { replacement?.stop() }
                                replacement?.release()
                                module.setMicrophoneMute(true)
                                onError(error.message ?: "Не удалось захватить звук приложения")
                            }
                        }

                        override fun onWebRtcAudioRecordStop() = Unit
                    }
                )
                .setAudioRecordErrorCallback(
                    object : JavaAudioDeviceModule.AudioRecordErrorCallback {
                        override fun onWebRtcAudioRecordInitError(message: String) =
                            onError(message)

                        override fun onWebRtcAudioRecordStartError(
                            code: JavaAudioDeviceModule.AudioRecordStartErrorCode,
                            message: String,
                        ) = onError(message)

                        override fun onWebRtcAudioRecordError(message: String) = onError(message)
                    }
                )
                .createAudioDeviceModule()
        module.setMicrophoneMute(true)
        module.setSpeakerMute(true)
    }
}
