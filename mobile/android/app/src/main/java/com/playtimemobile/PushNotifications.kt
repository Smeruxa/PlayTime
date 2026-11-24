package com.playtimemobile

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

internal object PushNotifications {
    @Volatile var foreground = false
    @Volatile private var activeChat: String? = null
    private const val CHANNEL = "playtime.messages"
    private const val TAG = "playtime.message"

    private fun preferences(context: Context) =
        context.getSharedPreferences("playtime.push", Context.MODE_PRIVATE)

    private fun positiveId(value: Any?): Long? {
        if (value !is Number) return null
        val number = value.toDouble()
        if (!number.isFinite() || number <= 0 || number > 9007199254740991.0 || number % 1.0 != 0.0)
            return null
        return number.toLong()
    }

    @Synchronized
    fun reconcileAccount(context: Context, userId: Long?) {
        if (userId != null && preferences(context).getLong("userId", 0) == userId) return
        setContext(context, userId, false, emptySet(), null)
    }

    @Synchronized
    fun setContext(
        context: Context,
        userId: Long?,
        enabled: Boolean,
        muted: Set<String>,
        active: String?,
    ) {
        val prefs = preferences(context)
        val accountChanged = prefs.getLong("userId", 0) != (userId ?: 0)
        val editor =
            prefs
                .edit()
                .putLong("userId", userId ?: 0)
                .putBoolean("enabled", enabled && userId != null)
                .putStringSet("muted", muted.filter { it.length <= 256 }.toSet())
        if (accountChanged || !enabled || userId == null) {
            val manager = context.getSystemService(NotificationManager::class.java)
            prefs.getStringSet("notificationIds", emptySet())?.forEach { id ->
                id.toIntOrNull()?.let { manager.cancel(TAG, it) }
            }
            editor.remove("events").remove("notificationIds")
        }
        check(editor.commit()) { "Не удалось сохранить настройки уведомлений" }
        activeChat = active?.take(256)
    }

    fun receive(context: Context, data: Map<String, String>): Boolean {
        val raw = data["chat"] ?: return false
        if (raw.length > 2048) return false
        return try {
            val chat = JSONObject(raw)
            val eventId = data["eventId"] ?: return false
            if (eventId.length !in 1..128) return false
            chat.put("eventId", eventId)
            data["expiresAt"]?.let { chat.put("expiresAt", it) }
            show(context, data["title"] ?: "PlayTime", chat.toString(), fromPush = true)
        } catch (_: Exception) {
            false
        }
    }

    @Synchronized
    fun show(
        context: Context,
        title: String,
        rawChat: String?,
        fromPush: Boolean = false,
    ): Boolean {
        if (rawChat == null || rawChat.length > 2048) return false
        val target = runCatching { JSONObject(rawChat) }.getOrNull() ?: return false
        val userId = positiveId(target.opt("userId")) ?: return false
        if (target.opt("version") != 1) return false
        val prefs = preferences(context)
        if (!prefs.getBoolean("enabled", false) || prefs.getLong("userId", 0) != userId)
            return false
        val kind = target.optString("kind")
        val isCall = kind == "call"
        if (!isCall && kind != "chat") return false
        val key =
            if (isCall) "dm:$title"
            else {
                val id = positiveId(target.opt("id")) ?: return false
                val name = target.opt("name") as? String ?: return false
                if (name.isBlank() || name.length > 256 || target.opt("isRoom") !is Boolean)
                    return false
                if (target.getBoolean("isRoom")) "room:$id" else "dm:$name"
            }
        if (prefs.getStringSet("muted", emptySet())?.contains(key) == true) return false
        if (foreground && (isCall || activeChat == key)) return false
        val expiresAt = target.optString("expiresAt").toLongOrNull()
        if (isCall && fromPush && (expiresAt == null || expiresAt <= System.currentTimeMillis()))
            return false
        if (
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) != PackageManager.PERMISSION_GRANTED
        )
            return false
        val manager = context.getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled()) return false
        val event =
            target.optString("eventId").takeIf { it.length in 1..128 }?.let { "$userId:$it" }
        val events = runCatching {
            JSONArray(prefs.getString("events", "[]"))
        }
            .getOrElse { JSONArray() }
        if (event != null && (0 until events.length()).any { events.optString(it) == event })
            return false
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL,
                    "Сообщения и приглашения",
                    NotificationManager.IMPORTANCE_DEFAULT,
                )
            )
            if (
                manager.getNotificationChannel(CHANNEL)?.importance ==
                    NotificationManager.IMPORTANCE_NONE
            )
                return false
        }
        val id = 8000 + (("$userId:$key:$kind").hashCode() and 0x7fffffff) % 100000
        val intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("playtimeChat", rawChat)
            }
        val open =
            PendingIntent.getActivity(
                context,
                id,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val builder =
            NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title.take(120))
                .setContentText(if (isCall) "Входящий звонок" else "Новое сообщение")
                .setContentIntent(open)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setCategory(
                    if (isCall) NotificationCompat.CATEGORY_CALL
                    else NotificationCompat.CATEGORY_MESSAGE
                )
        if (expiresAt != null)
            builder.setTimeoutAfter((expiresAt - System.currentTimeMillis()).coerceAtLeast(1))
        manager.notify(TAG, id, builder.build())
        val editor = prefs.edit()
        if (event != null) {
            val next = JSONArray()
            for (index in (events.length() - 299).coerceAtLeast(0) until events.length()) next.put(
                events.getString(index)
            )
            next.put(event)
            editor.putString("events", next.toString())
        }
        editor
            .putStringSet(
                "notificationIds",
                ((prefs.getStringSet("notificationIds", emptySet()) ?: emptySet()) + id.toString())
                    .toList()
                    .takeLast(300)
                    .toSet(),
            )
            .commit()
        return true
    }
}
