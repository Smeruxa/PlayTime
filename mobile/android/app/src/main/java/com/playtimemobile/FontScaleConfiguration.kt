package com.playtimemobile

import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext

internal object FontScaleConfiguration {
    fun refresh(context: ReactContext?) {
        (context?.getNativeModule("DeviceInfo") as? LifecycleEventListener)?.onHostResume()
    }
}
