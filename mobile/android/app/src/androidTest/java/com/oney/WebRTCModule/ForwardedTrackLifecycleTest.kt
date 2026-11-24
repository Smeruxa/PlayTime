package com.oney.WebRTCModule

import android.util.SparseArray
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.ReadableMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection

@RunWith(AndroidJUnit4::class)
class ForwardedTrackLifecycleTest {
    @Test fun disposingRegisteredAudioDetachesItBeforeStreamRelease() = verifyDisposal(false)

    @Test fun closingPeerBeforeRelayDisposalKeepsDelayedNativeDisposeSafe() = verifyDisposal(true)

    @Suppress("DEPRECATION")
    private fun verifyDisposal(closeBefore: Boolean) {
        val completed = CountDownLatch(1)
        val failure = AtomicReference<Throwable?>()
        WebRTCModule.playTimeExecute {
            try {
                val context =
                    BridgeReactContext(InstrumentationRegistry.getInstrumentation().targetContext)
                val module =
                    object : WebRTCModule(context) {
                        override fun sendEvent(eventName: String, params: ReadableMap?) = Unit
                    }
                @Suppress("UNCHECKED_CAST")
                val peers =
                    WebRTCModule::class
                        .java
                        .getDeclaredField("mPeerConnectionObservers")
                        .apply { isAccessible = true }
                        .get(module) as SparseArray<PeerConnectionObserver>
                val source = module.mFactory.createAudioSource(MediaConstraints())
                val track = module.mFactory.createAudioTrack("forwarded-lifecycle-test", source)
                val observer = PeerConnectionObserver(module, 7204)
                val peer =
                    checkNotNull(
                        module.mFactory.createPeerConnection(
                            PeerConnection.RTCConfiguration(emptyList()),
                            observer,
                        )
                    )
                observer.setPeerConnection(peer)
                peers.put(7204, observer)
                peer.addTrack(track)
                assertEquals(1, peer.senders.size)
                val stream = module.mFactory.createLocalMediaStream("forwarded-lifecycle-stream")
                module.playTimeRegisterAudioTrack(track)
                stream.addTrack(track)
                module.localStreams["test"] = stream
                if (closeBefore) {
                    observer.close()
                    assertEquals(
                        "A closed PC hides senders; detach must happen before close",
                        0,
                        peer.senders.size,
                    )
                }
                module.playTimeDisposeAudioTrack("forwarded-lifecycle-test")
                assertTrue(
                    "Native sender must be detached before a source owner disappears",
                    peer.senders.all { it.track() == null },
                )
                assertTrue(
                    "No disposed Java track may remain in a live RN stream",
                    stream.audioTracks.isEmpty(),
                )
                module.localStreams.remove("test")
                stream.dispose()
                module.playTimeDisposeAudioTrack("forwarded-lifecycle-test")
                peers.remove(7204)
                peer.dispose()
                source.dispose()
                module.mFactory.dispose()
            } catch (error: Throwable) {
                failure.set(error)
            } finally {
                completed.countDown()
            }
        }
        assertTrue(completed.await(5, TimeUnit.SECONDS))
        failure.get()?.let { throw it }
    }
}
