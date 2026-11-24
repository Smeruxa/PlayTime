package com.playtimemobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

internal object CallAudioEvents {
    var onEndRequested: (() -> Unit)? = null
}

class CallAudioService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "playtime.END_CALL") {
            CallAudioEvents.onEndRequested?.invoke()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val channel = "playtime.calls"
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(
                    NotificationChannel(
                        channel,
                        "Текущий звонок",
                        NotificationManager.IMPORTANCE_LOW,
                    )
                )
        }
        val open =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java).putExtra("playtimeChat", "active-call"),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val endCall =
            PendingIntent.getService(
                this,
                1,
                Intent(this, CallAudioService::class.java).setAction("playtime.END_CALL"),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val notification =
            NotificationCompat.Builder(this, channel)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("PlayTime · Звонок")
                .setContentText("Нажмите, чтобы вернуться к звонку")
                .setContentIntent(open)
                .setOngoing(true)
                .addAction(R.drawable.ic_notification, "Завершить", endCall)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build()
        if (Build.VERSION.SDK_INT >= 30)
            startForeground(7201, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        else startForeground(7201, notification)
        return START_NOT_STICKY
    }
}
