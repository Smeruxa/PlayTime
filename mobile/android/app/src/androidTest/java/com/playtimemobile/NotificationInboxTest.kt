package com.playtimemobile

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotificationInboxTest {
    @Test
    fun notificationSurvivesBeforeReactAndConsumesExactlyOnce() {
        NotificationInbox.consume()
        val launch = Intent().putExtra("playtimeChat", "cold-chat")
        NotificationInbox.capture(launch)
        assertEquals("cold-chat", NotificationInbox.peek())
        assertNull(launch.getStringExtra("playtimeChat"))
        assertEquals("cold-chat", NotificationInbox.consume())
        assertNull(NotificationInbox.consume())
        NotificationInbox.capture(launch)
        assertNull(NotificationInbox.consume())
        NotificationInbox.capture(Intent().putExtra("playtimeChat", "warm-chat"))
        assertEquals("warm-chat", NotificationInbox.peek())
        assertEquals("warm-chat", NotificationInbox.consume())
    }
}
