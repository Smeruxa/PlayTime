package com.playtimemobile

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.ContextWrapper
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReadableMap
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import ru.rustore.sdk.pushclient.messaging.model.Notification
import ru.rustore.sdk.pushclient.messaging.model.RemoteMessage

@RunWith(AndroidJUnit4::class)
class PushNotificationsTest {
    @get:Rule
    val permission: GrantPermissionRule =
        GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)
    private val original = InstrumentationRegistry.getInstrumentation().targetContext
    private val context =
        object : ContextWrapper(original) {
            override fun getSharedPreferences(name: String, mode: Int) =
                super.getSharedPreferences("$name.instrumentation", mode)
        }
    private val manager = original.getSystemService(NotificationManager::class.java)

    private fun chat(userId: Long = 7000001, room: Boolean = false) =
        JSONObject()
            .put("version", 1)
            .put("userId", userId)
            .put("kind", "chat")
            .put("id", 7000002)
            .put("name", "NativePushTest")
            .put("isRoom", room)
            .toString()

    private fun payload(event: String = "m:7000001") =
        mapOf(
            "chat" to chat(),
            "title" to "NativePushTest",
            "eventId" to event,
        )

    @Before
    fun setup() {
        context.getSharedPreferences("playtime.push", Context.MODE_PRIVATE).edit().clear().commit()
        PushNotifications.foreground = false
        PushNotifications.setContext(context, 7000001, true, emptySet(), null)
    }

    @After
    fun cleanup() {
        PushNotifications.setContext(context, null, false, emptySet(), null)
        PushNotifications.foreground = false
    }

    @Test
    fun coldDeliveryUsesSavedAccountAndNeverShowsMessageContents() {
        assertTrue(PushNotifications.receive(context, payload()))
        val notification =
            manager.activeNotifications.first {
                it.notification.extras.getString("android.title") == "NativePushTest"
            }
        assertEquals("Новое сообщение", notification.notification.extras.getString("android.text"))
        assertFalse(PushNotifications.receive(context, payload()))
        val socketTarget = JSONObject(chat()).put("eventId", "m:7000001").toString()
        assertFalse(PushNotifications.show(context, "NativePushTest", socketTarget))
    }

    @Test
    fun rejectsWrongAccountDisabledLogoutAndMutedChat() {
        assertFalse(PushNotifications.receive(context, payload() + ("chat" to chat(123))))
        PushNotifications.setContext(context, 7000001, true, setOf("dm:NativePushTest"), null)
        assertFalse(PushNotifications.receive(context, payload()))
        PushNotifications.setContext(context, 7000001, false, emptySet(), null)
        assertFalse(PushNotifications.receive(context, payload()))
        PushNotifications.setContext(context, null, false, emptySet(), null)
        assertFalse(PushNotifications.receive(context, payload()))
    }

    @Test
    fun sameAccountReconciliationPreservesConsentMutedChatsAndDeliveredEvents() {
        assertTrue(PushNotifications.receive(context, payload()))
        PushNotifications.setContext(context, 7000001, true, setOf("dm:MutedPeer"), null)
        val prefs = context.getSharedPreferences("playtime.push", Context.MODE_PRIVATE)
        val before = prefs.all

        PushNotifications.reconcileAccount(context, 7000001)

        assertEquals(before, prefs.all)
        assertFalse(PushNotifications.receive(context, payload()))
        val muted = JSONObject(chat()).put("name", "MutedPeer").toString()
        assertFalse(PushNotifications.receive(context, payload("m:7000002") + ("chat" to muted)))
        assertTrue(PushNotifications.receive(context, payload("m:7000003")))
    }

    @Test
    fun accountSwitchAndLogoutCancelNotificationsAndRejectPreviousReceiver() {
        assertTrue(PushNotifications.receive(context, payload()))
        PushNotifications.reconcileAccount(context, 7000003)
        val prefs = context.getSharedPreferences("playtime.push", Context.MODE_PRIVATE)
        assertEquals(7000003L, prefs.getLong("userId", 0))
        assertFalse(prefs.getBoolean("enabled", true))
        assertFalse(prefs.contains("events"))
        assertFalse(prefs.contains("notificationIds"))
        assertFalse(
            manager.activeNotifications.any {
                it.notification.extras.getString("android.title") == "NativePushTest"
            }
        )
        assertFalse(PushNotifications.receive(context, payload("m:7000004")))

        PushNotifications.setContext(context, 7000001, true, emptySet(), null)
        assertTrue(PushNotifications.receive(context, payload("m:7000005")))
        PushNotifications.reconcileAccount(context, null)
        assertEquals(0L, prefs.getLong("userId", -1))
        assertFalse(prefs.getBoolean("enabled", true))
        assertFalse(
            manager.activeNotifications.any {
                it.notification.extras.getString("android.title") == "NativePushTest"
            }
        )
        assertFalse(PushNotifications.receive(context, payload("m:7000006")))
    }

    private fun remoteMessage(data: Map<String, String>, notification: Notification?) =
        RemoteMessage("native-test", 0, 60, "native-test", null, data, null, notification)

    private fun notification(title: String? = null, body: String? = null, image: Uri? = null) =
        Notification(title, body, null, image, null, null, null, null)

    @Test
    fun emptySdkNotificationWrapperDeliversDataOnlyThroughAccountPolicy() {
        assertTrue(PushMessageReceiver.receive(context, remoteMessage(payload(), notification())))
        assertFalse(PushMessageReceiver.receive(context, remoteMessage(payload(), notification())))
        assertFalse(
            PushMessageReceiver.receive(
                context,
                remoteMessage(payload("m:7000007") + ("chat" to chat(123)), notification()),
            )
        )
        assertFalse(
            PushMessageReceiver.receive(
                context,
                remoteMessage(payload("m:7000008") + ("chat" to "invalid"), notification()),
            )
        )
        PushNotifications.setContext(context, 7000001, true, setOf("dm:NativePushTest"), null)
        assertFalse(
            PushMessageReceiver.receive(
                context,
                remoteMessage(payload("m:7000009"), notification()),
            )
        )
    }

    @Test
    fun sdkTitleNotificationNeverAlsoCreatesOurDataNotification() {
        assertFalse(
            PushMessageReceiver.receive(
                context,
                remoteMessage(payload(), notification(title = "SDK title")),
            )
        )
        assertFalse(
            manager.activeNotifications.any {
                it.notification.extras.getString("android.title") == "NativePushTest"
            }
        )
        for ((index, wrapper) in
            listOf(
                    null,
                    notification(title = "  \t"),
                    notification(body = "SDK body"),
                    notification(image = Uri.parse("https://example.invalid/image.png")),
                )
                .withIndex()) {
            assertTrue(
                PushMessageReceiver.receive(
                    context,
                    remoteMessage(payload("m:wrapper:$index"), wrapper),
                )
            )
        }
    }

    @Test
    fun rejectsCoercedIdentifiersAndInvalidTargetTypes() {
        for (value in listOf("7000001", 7000001.1, -1, 9007199254740992L)) {
            val malformed = JSONObject(chat()).put("userId", value).toString()
            assertFalse(PushNotifications.receive(context, payload() + ("chat" to malformed)))
        }
        val invalidRoom = JSONObject(chat()).put("isRoom", "false").toString()
        assertFalse(PushNotifications.receive(context, payload() + ("chat" to invalidRoom)))
        val invalidName = JSONObject(chat()).put("name", 123).toString()
        assertFalse(PushNotifications.receive(context, payload() + ("chat" to invalidName)))
    }

    @Test
    fun suppressesVisibleChatButDeliversAfterActivityLeavesForeground() {
        PushNotifications.setContext(context, 7000001, true, emptySet(), "dm:NativePushTest")
        PushNotifications.foreground = true
        assertFalse(PushNotifications.receive(context, payload()))
        PushNotifications.foreground = false
        assertTrue(PushNotifications.receive(context, payload()))
    }

    @Test
    fun ignoresExpiredMalformedAndForegroundCallPushes() {
        val call =
            JSONObject().put("version", 1).put("userId", 7000001).put("kind", "call").toString()
        val data = mapOf("chat" to call, "eventId" to "c:7000001", "title" to "NativePushTest")
        assertFalse(PushNotifications.receive(context, data))
        assertFalse(PushNotifications.receive(context, data + ("expiresAt" to "1")))
        assertFalse(PushNotifications.receive(context, payload() + ("chat" to "invalid")))
        val valid = data + ("expiresAt" to (System.currentTimeMillis() + 30000).toString())
        PushNotifications.foreground = true
        assertFalse(PushNotifications.receive(context, valid))
        PushNotifications.foreground = false
        assertTrue(PushNotifications.receive(context, valid))
    }

    @Test
    fun unconfiguredProjectReturnsExplicitUnavailableWithoutNetwork() {
        if (BuildConfig.RUSTORE_PROJECT_ID.isNotBlank()) return
        var result: ReadableMap? = null
        var error: Any? = null
        PushClient.getToken(
            PromiseImpl(
                Callback { result = it.firstOrNull() as? ReadableMap },
                Callback { error = it.firstOrNull() },
            )
        )
        assertNull(error)
        assertEquals("not_configured", result?.getString("reason"))
        assertEquals(false, result?.getBoolean("available"))
        assertTrue(result?.isNull("token") == true)
    }
}
