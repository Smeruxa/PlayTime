package com.playtimemobile

import android.content.Context
import android.media.MediaRecorder
import org.webrtc.audio.JavaAudioDeviceModule

internal interface RelayAudioInput {
    val module: JavaAudioDeviceModule

    fun mute() = module.setMicrophoneMute(true)

    fun release() = module.release()
}

internal class MicrophoneRelayInput(
    context: Context,
    onReady: () -> Unit,
    onError: (String) -> Unit,
) : RelayAudioInput {
    override val module =
        JavaAudioDeviceModule.builder(context)
            .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
            .setInputSampleRate(48000)
            .setUseStereoInput(false)
            .setAudioRecordStateCallback(
                object : JavaAudioDeviceModule.AudioRecordStateCallback {
                    override fun onWebRtcAudioRecordStart() = onReady()

                    override fun onWebRtcAudioRecordStop() = Unit
                }
            )
            .setAudioRecordErrorCallback(
                object : JavaAudioDeviceModule.AudioRecordErrorCallback {
                    override fun onWebRtcAudioRecordInitError(message: String) = onError(message)

                    override fun onWebRtcAudioRecordStartError(
                        code: JavaAudioDeviceModule.AudioRecordStartErrorCode,
                        message: String,
                    ) = onError(message)

                    override fun onWebRtcAudioRecordError(message: String) = onError(message)
                }
            )
            .createAudioDeviceModule()
            .apply { setSpeakerMute(true) }
}
