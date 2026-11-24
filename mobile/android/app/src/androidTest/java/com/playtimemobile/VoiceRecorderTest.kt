package com.playtimemobile

import android.Manifest
import android.net.Uri
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReadableMap
import java.io.File
import java.util.Collections
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VoiceRecorderTest {
    @get:Rule
    val permission: GrantPermissionRule =
        GrantPermissionRule.grant(Manifest.permission.RECORD_AUDIO)
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val directory = File(context.cacheDir, "recording-test-${UUID.randomUUID()}")
    private val limit = CountDownLatch(1)
    private var inCall = false
    private lateinit var activity: ActivityScenario<MainActivity>
    private val recorder =
        VoiceRecorder(
            context,
            { directory.apply { mkdirs() } },
            { file ->
                Arguments.createMap().apply { putString("uri", Uri.fromFile(file).toString()) }
            },
            { inCall },
            { limit.countDown() },
        ) { promise, action ->
            try {
                promise.resolve(action())
            } catch (error: Exception) {
                promise.reject("TEST_NATIVE", error.message, error)
            }
        }

    private class Result {
        var value: Any? = null
        var error: String? = null
        val promise =
            PromiseImpl(
                Callback { args -> value = args.firstOrNull() },
                Callback { args ->
                    error = (args.firstOrNull() as? ReadableMap)?.getString("code")
                },
            )
    }

    @Before
    fun foregroundActivity() {
        activity = ActivityScenario.launch(MainActivity::class.java)
    }

    @After
    fun cleanUp() {
        recorder.cancel()
        activity.close()
        directory.deleteRecursively()
    }

    @Test
    fun durationLimitKeepsFinalizedAacForPreview() {
        val samples = Collections.synchronizedList(mutableListOf<Double>())
        recorder.onLevel = { samples.add(it) }
        val started = Result()
        recorder.start(1.0, started.promise)
        assertNull(started.error)
        assertEquals(true, started.value)
        assertTrue("MediaRecorder must deliver MAX_DURATION", limit.await(8, TimeUnit.SECONDS))
        assertEquals(0.0, samples.last(), 0.0)
        val finalSampleCount = samples.size
        Thread.sleep(150)
        assertEquals("Duration limit must stop amplitude polling", finalSampleCount, samples.size)
        val stopped = Result()
        recorder.stop(stopped.promise)
        assertNull(stopped.error)
        val result = stopped.value as ReadableMap
        assertTrue(result.getDouble("durationMs") in 300.0..1000.0)
        assertEquals(result.getDouble("durationMs"), result.getDouble("duration"), 0.0)
        assertTrue(File(checkNotNull(Uri.parse(result.getString("uri")).path)).length() > 32)
        assertFalse(recorder.isRecording)
    }

    @Test
    fun cancelDeletesPartialCaptureAndReleasesMicrophone() {
        val started = Result()
        recorder.start(10.0, started.promise)
        assertNull(started.error)
        recorder.cancel()
        assertFalse(recorder.isRecording)
        assertTrue(directory.listFiles().orEmpty().isEmpty())
        val second = Result()
        recorder.start(10.0, second.promise)
        assertNull(second.error)
        assertEquals(true, second.value)
    }

    @Test
    fun activeCallAndDuplicateCaptureAreRejected() {
        inCall = true
        val call = Result()
        recorder.start(10.0, call.promise)
        assertEquals("MICROPHONE_BUSY", call.error)
        inCall = false
        val started = Result()
        recorder.start(10.0, started.promise)
        assertNull(started.error)
        val duplicate = Result()
        recorder.start(1.0, duplicate.promise)
        assertEquals("MICROPHONE_BUSY", duplicate.error)
        assertTrue(recorder.isRecording)
    }

    @Test
    fun rejectsInvalidDurationAndStopWithoutRecording() {
        val invalid = Result()
        recorder.start(Double.NaN, invalid.promise)
        assertEquals("RECORDING_LIMIT", invalid.error)
        val stopped = Result()
        recorder.stop(stopped.promise)
        assertEquals("NO_RECORDING", stopped.error)
    }

    @Test
    fun levelMeterReportsBoundedValuesAndStopsAfterCancel() {
        val samples = Collections.synchronizedList(mutableListOf<Double>())
        val sampled = CountDownLatch(3)
        recorder.onLevel = { value ->
            samples.add(value)
            sampled.countDown()
        }
        val started = Result()
        recorder.start(5.0, started.promise)
        assertNull(started.error)
        assertTrue("A live recorder should emit meter samples", sampled.await(3, TimeUnit.SECONDS))
        recorder.cancel()
        assertEquals(0.0, samples.last(), 0.0)
        val finalCount = samples.size
        Thread.sleep(250)
        assertEquals(
            "Canceled capture must not leave a polling callback alive",
            finalCount,
            samples.size,
        )
        assertTrue(samples.all { it.isFinite() && it in 0.0..1.0 })
        assertEquals(0.0, VoiceRecorder.normalizedLevel(-1), 0.0)
        assertEquals(1.0, VoiceRecorder.normalizedLevel(Int.MAX_VALUE), 0.0)
        assertEquals(0.5, VoiceRecorder.normalizedLevel(16384), 0.001)
    }
}
