package com.playtimemobile

import android.app.Application
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import java.util.concurrent.atomic.AtomicBoolean
import ru.rustore.sdk.core.feature.model.FeatureAvailabilityResult
import ru.rustore.sdk.pushclient.RuStorePushClient
import ru.rustore.sdk.pushclient.common.logger.Logger

internal object PushClient {
    @Volatile var onTokenChanged: ((String) -> Unit)? = null
    private var initializationFailed = false

    fun initialize(application: Application) {
        if (BuildConfig.RUSTORE_PROJECT_ID.isBlank()) return
        try {
            RuStorePushClient.init(application, BuildConfig.RUSTORE_PROJECT_ID, SilentPushLogger)
        } catch (_: Exception) {
            initializationFailed = true
        }
    }

    fun getToken(promise: Promise) {
        val complete = AtomicBoolean(false)
        val handler = Handler(Looper.getMainLooper())
        var timeout: Runnable? = null
        fun finish(token: String?, available: Boolean, reason: String? = null) {
            if (!complete.compareAndSet(false, true)) return
            timeout?.let { handler.removeCallbacks(it) }
            promise.resolve(
                Arguments.createMap().apply {
                    if (token == null) putNull("token") else putString("token", token)
                    putBoolean("available", available)
                    if (reason != null) putString("reason", reason)
                }
            )
        }
        if (BuildConfig.RUSTORE_PROJECT_ID.isBlank()) {
            finish(null, false, "not_configured")
            return
        }
        if (initializationFailed || !RuStorePushClient.isInitialized) {
            finish(null, false, "initialization_failed")
            return
        }
        timeout = Runnable { finish(null, false, "timeout") }
        handler.postDelayed(timeout!!, 15000)
        try {
            RuStorePushClient.checkPushAvailability()
                .addOnSuccessListener { availability ->
                    if (complete.get()) return@addOnSuccessListener
                    if (availability != FeatureAvailabilityResult.Available) {
                        finish(null, false, "distributor_unavailable")
                        return@addOnSuccessListener
                    }
                    RuStorePushClient.getToken()
                        .addOnSuccessListener { token -> finish(token, true) }
                        .addOnFailureListener { finish(null, false, "token_unavailable") }
                }
                .addOnFailureListener { finish(null, false, "distributor_unavailable") }
        } catch (_: Exception) {
            finish(null, false, "token_unavailable")
        }
    }

    fun tokenChanged(token: String) {
        if (token.isNotBlank()) onTokenChanged?.invoke(token)
    }
}

private object SilentPushLogger : Logger {
    override fun verbose(message: String, throwable: Throwable?) = Unit

    override fun debug(message: String, throwable: Throwable?) = Unit

    override fun info(message: String, throwable: Throwable?) = Unit

    override fun warn(message: String, throwable: Throwable?) = Unit

    override fun error(message: String, throwable: Throwable?) = Unit

    override fun createLogger(tag: String): Logger = this
}
