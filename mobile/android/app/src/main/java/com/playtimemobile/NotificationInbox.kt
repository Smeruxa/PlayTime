package com.playtimemobile

import android.content.Intent

internal object NotificationInbox {
    private var pending: String? = null

    @Synchronized
    fun capture(intent: Intent?) {
        val chat = intent?.getStringExtra("playtimeChat") ?: return
        pending = chat
        intent.removeExtra("playtimeChat")
    }

    @Synchronized fun peek(): String? = pending

    @Synchronized
    fun consume(): String? {
        val chat = pending
        pending = null
        return chat
    }
}
