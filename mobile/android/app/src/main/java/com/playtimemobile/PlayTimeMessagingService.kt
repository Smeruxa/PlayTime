package com.playtimemobile

import android.content.Context
import ru.rustore.sdk.pushclient.messaging.model.RemoteMessage
import ru.rustore.sdk.pushclient.messaging.service.RuStoreMessagingService

class PlayTimeMessagingService : RuStoreMessagingService() {
    override fun onNewToken(token: String) = PushClient.tokenChanged(token)

    override fun onMessageReceived(message: RemoteMessage) {
        PushMessageReceiver.receive(this, message)
    }
}

internal object PushMessageReceiver {
    fun receive(context: Context, message: RemoteMessage): Boolean {
        val notification = message.notification
        if (!notification?.title.isNullOrBlank()) return false
        return PushNotifications.receive(context, message.data)
    }
}
