package com.playtimemobile

import android.content.res.Configuration
import android.content.res.Resources
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FontScaleConfigurationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun shell(command: String): String =
        instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
            android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use {
                it.readText().trim()
            }
        }

    @Test
    fun changingSystemFontScaleKeepsTheActiveActivity() {
        val original = shell("settings get system font_scale")
        val target = if (original.toFloatOrNull() == 1.6f) 1.2f else 1.6f
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                var initial: MainActivity? = null
                scenario.onActivity { initial = it }
                shell("settings put system font_scale $target")
                val deadline = SystemClock.elapsedRealtime() + 10_000
                var updated = false
                while (!updated && SystemClock.elapsedRealtime() < deadline) {
                    scenario.onActivity { activity ->
                        assertSame(
                            "Font scaling must preserve an active call's Activity",
                            initial,
                            activity,
                        )
                        updated = activity.resources.configuration.fontScale == target
                    }
                    if (!updated) SystemClock.sleep(100)
                }
                assertTrue("Android must deliver the changed font scale", updated)
            }
        } finally {
            if (original == "null") shell("settings delete system font_scale")
            else shell("settings put system font_scale $original")
        }
    }

    @Suppress("DEPRECATION")
    @Test
    fun configurationRefreshEmitsTheNewFontScaleToJavaScript() {
        val base = instrumentation.targetContext
        var currentResources =
            base
                .createConfigurationContext(
                    Configuration(base.resources.configuration).apply { fontScale = 1f }
                )
                .resources
        var emitted: ReadableMap? = null
        lateinit var deviceInfo: NativeModule
        val context =
            object : BridgeReactContext(base) {
                override fun getResources(): Resources = currentResources

                override fun hasActiveReactInstance(): Boolean = true

                override fun getNativeModule(name: String): NativeModule? =
                    if (name == "DeviceInfo") deviceInfo else null

                override fun emitDeviceEvent(eventName: String, args: Any?) {
                    if (eventName == "didUpdateDimensions") emitted = args as ReadableMap
                }
            }
        val moduleClass = Class.forName("com.facebook.react.modules.deviceinfo.DeviceInfoModule")
        deviceInfo =
            moduleClass.getConstructor(ReactApplicationContext::class.java).newInstance(context)
                as NativeModule
        moduleClass.getMethod("getConstants").invoke(deviceInfo)
        currentResources =
            base
                .createConfigurationContext(
                    Configuration(base.resources.configuration).apply { fontScale = 2f }
                )
                .resources
        try {
            FontScaleConfiguration.refresh(context)
            assertNotNull("useWindowDimensions needs a didUpdateDimensions event", emitted)
            assertEquals(
                2.0,
                emitted!!.getMap("windowPhysicalPixels")!!.getDouble("fontScale"),
                0.0,
            )
            assertEquals(
                2.0,
                emitted!!.getMap("screenPhysicalPixels")!!.getDouble("fontScale"),
                0.0,
            )
        } finally {
            deviceInfo.invalidate()
        }
    }
}
