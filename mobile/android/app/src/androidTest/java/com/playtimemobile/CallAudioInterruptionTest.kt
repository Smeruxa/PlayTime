package com.playtimemobile

import android.Manifest
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReadableMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CallAudioInterruptionTest {
    @get:Rule
    val permission: GrantPermissionRule =
        GrantPermissionRule.grant(Manifest.permission.RECORD_AUDIO)

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

    @Suppress("DEPRECATION")
    @Test
    fun acceptingCallCancelsVoiceMessageCapture() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        ActivityScenario.launch(MainActivity::class.java).use {
            val native = PlayTimeNativeModule(BridgeReactContext(context))
            try {
                val recording = Result()
                native.startVoiceRecordingWithLimit(10.0, recording.promise)
                assertNull(recording.error)
                assertEquals(true, recording.value)
                val call = Result()
                native.startCallAudio(true, call.promise)
                assertNull(call.error)
                assertEquals(true, call.value)
                val stopped = Result()
                native.stopVoiceRecording(stopped.promise)
                assertEquals("NO_RECORDING", stopped.error)
                val progress = Result()
                native.getAudioProgress(progress.promise)
                assertEquals(false, (progress.value as ReadableMap).getBoolean("playing"))
            } finally {
                native.invalidate()
            }
        }
    }
}
