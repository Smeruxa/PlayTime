package com.playtimemobile

import android.content.Context
import android.media.projection.MediaProjection
import androidx.annotation.RequiresApi
import com.oney.WebRTCModule.WebRTCModule
import java.util.UUID
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule

@RequiresApi(29)
internal class AudioCaptureRelay(
    context: Context,
    projection: MediaProjection?,
    private val onReady: (AudioTrack) -> Unit,
    private val onError: (String) -> Unit,
) {
    private var closed = false
    private var captureReady = false
    private var connected = false
    private var delivered = false
    private var receivedTrack: AudioTrack? = null
    private var senderRemoteSet = false
    private var receiverRemoteSet = false
    private val senderCandidates = mutableListOf<IceCandidate>()
    private val receiverCandidates = mutableListOf<IceCandidate>()
    private val inputReady = {
        dispatch {
            captureReady = true
            deliverIfReady()
        }
    }
    private val inputError: (String) -> Unit = { message -> dispatch { onError(message) } }
    private val capture: RelayAudioInput =
        if (projection == null) MicrophoneRelayInput(context, inputReady, inputError)
        else PlaybackCaptureInput(context, projection, inputReady, inputError)
    private val sinkDevice =
        JavaAudioDeviceModule.builder(context).createAudioDeviceModule().apply {
            setSpeakerMute(true)
            setMicrophoneMute(true)
        }
    private val senderFactory =
        PeerConnectionFactory.builder()
            .setAudioDeviceModule(capture.module)
            .createPeerConnectionFactory()
    private val receiverFactory =
        PeerConnectionFactory.builder()
            .setAudioDeviceModule(sinkDevice)
            .createPeerConnectionFactory()
    private val configuration =
        PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.DISABLED
        }
    private val source: AudioSource
    private val localTrack: AudioTrack
    private val sender: PeerConnection
    private val receiver: PeerConnection

    init {
        sender = checkNotNull(senderFactory.createPeerConnection(configuration, observer(true)))
        receiver =
            checkNotNull(receiverFactory.createPeerConnection(configuration, observer(false)))
        receiver.setAudioRecording(false)
        val constraints =
            MediaConstraints().apply {
                optional.add(
                    MediaConstraints.KeyValuePair(
                        "googEchoCancellation",
                        (projection == null).toString(),
                    )
                )
                optional.add(
                    MediaConstraints.KeyValuePair(
                        "googAutoGainControl",
                        (projection == null).toString(),
                    )
                )
                optional.add(
                    MediaConstraints.KeyValuePair(
                        "googNoiseSuppression",
                        (projection == null).toString(),
                    )
                )
            }
        source = senderFactory.createAudioSource(constraints)
        val name = if (projection == null) "microphone" else "screen"
        localTrack = senderFactory.createAudioTrack("playtime-$name-${UUID.randomUUID()}", source)
        sender.addTrack(localTrack, listOf("playtime-local-system-audio"))
    }

    fun start() {
        sender.createOffer(
            sdpObserver(
                onCreated = { offer ->
                    sender.setLocalDescription(
                        sdpObserver(
                            onSet = {
                                receiver.setRemoteDescription(
                                    sdpObserver(
                                        onSet = {
                                            receiverRemoteSet = true
                                            receiverCandidates.forEach {
                                                receiver.addIceCandidate(it)
                                            }
                                            receiverCandidates.clear()
                                            createAnswer()
                                        }
                                    ),
                                    offer,
                                )
                            }
                        ),
                        offer,
                    )
                }
            ),
            MediaConstraints(),
        )
    }

    private fun createAnswer() {
        receiver.createAnswer(
            sdpObserver(
                onCreated = { answer ->
                    receiver.setLocalDescription(
                        sdpObserver(
                            onSet = {
                                sender.setRemoteDescription(
                                    sdpObserver(
                                        onSet = {
                                            senderRemoteSet = true
                                            senderCandidates.forEach { sender.addIceCandidate(it) }
                                            senderCandidates.clear()
                                        }
                                    ),
                                    answer,
                                )
                            }
                        ),
                        answer,
                    )
                }
            ),
            MediaConstraints(),
        )
    }

    private fun dispatch(action: () -> Unit) {
        WebRTCModule.playTimeExecute { if (!closed) action() }
    }

    private fun deliverIfReady() {
        val track = receivedTrack ?: return
        if (captureReady && connected && !delivered) {
            delivered = true
            onReady(track)
        }
    }

    private fun sdpObserver(onCreated: (SessionDescription) -> Unit = {}, onSet: () -> Unit = {}) =
        object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription) = dispatch {
                onCreated(description)
            }

            override fun onSetSuccess() = dispatch(onSet)

            override fun onCreateFailure(message: String) = dispatch { onError(message) }

            override fun onSetFailure(message: String) = dispatch { onError(message) }
        }

    private fun observer(isSender: Boolean) =
        object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) = dispatch {
                if (isSender) {
                    if (receiverRemoteSet) receiver.addIceCandidate(candidate)
                    else receiverCandidates.add(candidate)
                } else {
                    if (senderRemoteSet) sender.addIceCandidate(candidate)
                    else senderCandidates.add(candidate)
                }
            }

            override fun onConnectionChange(state: PeerConnection.PeerConnectionState) = dispatch {
                if (isSender && state == PeerConnection.PeerConnectionState.CONNECTED) {
                    connected = true
                    deliverIfReady()
                } else if (state == PeerConnection.PeerConnectionState.FAILED) {
                    onError("Не удалось соединить источник системного звука")
                }
            }

            override fun onAddTrack(trackReceiver: RtpReceiver, streams: Array<out MediaStream>) =
                dispatch {
                    if (!isSender) {
                        receivedTrack = trackReceiver.track() as? AudioTrack
                        deliverIfReady()
                    }
                }

            override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit

            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit

            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit

            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit

            override fun onAddStream(stream: MediaStream) = Unit

            override fun onRemoveStream(stream: MediaStream) = Unit

            override fun onDataChannel(channel: DataChannel) = Unit

            override fun onRenegotiationNeeded() = Unit
        }

    fun suspendCapture() {
        if (closed) return
        capture.mute()
        sender.setAudioRecording(false)
    }

    fun close() {
        if (closed) return
        closed = true
        capture.mute()
        sender.close()
        receiver.close()
        sender.dispose()
        receiver.dispose()
        localTrack.dispose()
        source.dispose()
        senderFactory.dispose()
        receiverFactory.dispose()
        capture.release()
        sinkDevice.release()
    }
}
