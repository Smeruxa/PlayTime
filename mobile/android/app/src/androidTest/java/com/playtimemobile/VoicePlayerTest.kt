package com.playtimemobile

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReadableMap
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VoicePlayerTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val file = File(context.cacheDir, "playback-test-${UUID.randomUUID()}.wav")
    private val ended = CountDownLatch(1)
    private val player = VoicePlayer(context, { false }, { ended.countDown() }, {})
    private lateinit var activity: ActivityScenario<MainActivity>

    private class Result {
        var value: Any? = null
        var error: String? = null
        val complete = CountDownLatch(1)
        val promise =
            PromiseImpl(
                Callback { args ->
                    value = args.firstOrNull()
                    complete.countDown()
                },
                Callback { args ->
                    error = (args.firstOrNull() as? ReadableMap)?.getString("code")
                    complete.countDown()
                },
            )
    }

    @Before
    fun foregroundActivity() {
        activity = ActivityScenario.launch(MainActivity::class.java)
        instrumentation.context.assets.open("voice-player.wav").use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
    }

    @After
    fun cleanUp() {
        player.stop()
        activity.close()
        file.delete()
    }

    @Test
    fun playsPausesSeeksResumesAndReportsActualProgress() {
        val start = Result()
        player.play(file.toURI().toString(), start.promise)
        assertTrue(start.complete.await(3, TimeUnit.SECONDS))
        assertNull(start.error)
        assertEquals(true, start.value)
        assertEquals(3000.0, player.progress().getDouble("durationMs"), 20.0)
        assertTrue(player.pause())
        val pausedAt = player.progress().getDouble("positionMs")
        Thread.sleep(150)
        assertEquals(pausedAt, player.progress().getDouble("positionMs"), 20.0)
        assertFalse(player.progress().getBoolean("playing"))
        assertTrue(player.seek(2000.0))
        Thread.sleep(150)
        assertEquals(2000.0, player.progress().getDouble("positionMs"), 80.0)
        assertTrue(player.resume())
        assertTrue(ended.await(3, TimeUnit.SECONDS))
        assertFalse(player.progress().getBoolean("playing"))
    }

    @Test
    fun stoppingDuringPrepareSettlesPendingPlayWithoutStartingLater() {
        val start = Result()
        instrumentation.runOnMainSync {
            player.play(file.toURI().toString(), start.promise)
            player.stop()
        }
        assertTrue(start.complete.await(1, TimeUnit.SECONDS))
        assertEquals(false, start.value)
        assertNull(start.error)
        assertFalse(player.progress().getBoolean("playing"))
        assertFalse(player.resume())
    }

    @Test
    fun missingFileRejectsAndLeavesPlayerReusable() {
        val missing = Result()
        player.play(
            File(context.cacheDir, "missing-${UUID.randomUUID()}").toURI().toString(),
            missing.promise,
        )
        assertTrue(missing.complete.await(3, TimeUnit.SECONDS))
        assertEquals("PLAYBACK_FAILED", missing.error)
        assertFalse(player.progress().getBoolean("playing"))
        val valid = Result()
        player.play(file.toURI().toString(), valid.promise)
        assertTrue(valid.complete.await(3, TimeUnit.SECONDS))
        assertNull(valid.error)
        assertEquals(true, valid.value)
    }
}
