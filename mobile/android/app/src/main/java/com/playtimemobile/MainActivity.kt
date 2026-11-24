package com.playtimemobile

import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
    override fun getMainComponentName(): String = "PlayTime"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName)

    override fun onCreate(savedInstanceState: Bundle?) {
        NotificationInbox.capture(intent)
        super.onCreate(savedInstanceState)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
        val content = findViewById<View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            if (view.paddingBottom != ime) view.setPadding(0, 0, 0, ime)
            insets
        }
        ViewCompat.requestApplyInsets(content)
    }

    override fun onNewIntent(intent: Intent) {
        NotificationInbox.capture(intent)
        super.onNewIntent(intent)
        setIntent(intent)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        FontScaleConfiguration.refresh(reactHost?.currentReactContext)
    }

    override fun onResume() {
        super.onResume()
        PushNotifications.foreground = true
    }

    override fun onPause() {
        PushNotifications.foreground = false
        super.onPause()
    }
}
