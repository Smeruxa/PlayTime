package com.playtimemobile

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors

class PlayTimeNativeModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener, LifecycleEventListener {
    private val worker = Executors.newSingleThreadExecutor()
    private val audio by lazy { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private val files = NativeFiles(context, ::async)
    private val voiceRecorder =
        VoiceRecorder(
                context,
                files::sharedDirectory,
                { file -> files.fileMap(file, "audio/mp4", name = "voice.m4a") },
                { callActive },
                { emit("PlayTimeRecordingLimit", Arguments.createMap()) },
                ::async,
            )
            .apply {
                onLevel = { value ->
                    emit(
                        "PlayTimeRecordingLevel",
                        Arguments.createMap().apply { putDouble("level", value) },
                    )
                }
            }
    private val voicePlayer =
        VoicePlayer(
            context,
            { callActive },
            { error ->
                emit(
                    "PlayTimeAudioEnded",
                    Arguments.createMap().apply { if (error != null) putString("error", error) },
                )
            },
            {
                emit(
                    "PlayTimeAudioPaused",
                    Arguments.createMap().apply { putBoolean("interrupted", true) },
                )
            },
        )
    private var focusRequest: AudioFocusRequest? = null
    private var callActive = false
    private val callRinger = CallRinger(context)
    private val systemAudio =
        SystemAudioShare(context) { message ->
            emit(
                "PlayTimeScreenAudioError",
                Arguments.createMap().apply { putString("message", message) },
            )
        }
    private var oldAudioMode = AudioManager.MODE_NORMAL
    private var oldSpeaker = false
    private var proximityLock: PowerManager.WakeLock? = null
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        emit(
            "PlayTimeAudioFocus",
            Arguments.createMap().apply {
                putBoolean("interrupted", change != AudioManager.AUDIOFOCUS_GAIN)
            },
        )
    }

    init {
        CallAudioEvents.onEndRequested = { emit("PlayTimeCallEndRequested", Arguments.createMap()) }
        PushClient.onTokenChanged = { token ->
            emit(
                "PlayTimePushTokenChanged",
                Arguments.createMap().apply { putString("token", token) },
            )
        }
        context.addActivityEventListener(this)
        context.addLifecycleEventListener(this)
    }

    override fun getName() = "PlayTimeNative"

    override fun getConstants(): MutableMap<String, Any> =
        mutableMapOf(
            "apiBase" to BuildConfig.API_BASE,
            "socketUrl" to BuildConfig.SOCKET_URL,
            "version" to BuildConfig.VERSION_NAME,
            "sdkVersion" to Build.VERSION.SDK_INT,
            "systemAudioSupported" to (Build.VERSION.SDK_INT >= 29),
        )

    @ReactMethod fun addListener(eventName: String) = Unit

    @ReactMethod fun removeListeners(count: Double) = Unit

    private fun emit(name: String, value: WritableMap) {
        if (context.hasActiveReactInstance())
            context
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(name, value)
    }

    private fun async(promise: Promise, action: () -> Any?) {
        worker.execute {
            try {
                promise.resolve(action())
            } catch (error: Exception) {
                promise.reject(
                    "PLAYTIME_NATIVE",
                    error.message ?: "Не удалось выполнить действие",
                    error,
                )
            }
        }
    }

    @ReactMethod fun pickFile(mime: String, promise: Promise) = files.pickFile(mime, promise)

    @ReactMethod fun pickImage(promise: Promise) = files.pickImage(promise)

    @ReactMethod
    fun saveDocument(name: String, value: String, mime: String, promise: Promise) =
        files.saveDocument(name, value, mime, promise)

    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
    ) = files.onActivityResult(activity, requestCode, resultCode, data)

    override fun onNewIntent(intent: Intent) {
        NotificationInbox.peek()?.let { chat ->
            emit(
                "PlayTimeNotificationOpen",
                Arguments.createMap().apply { putString("chat", chat) },
            )
        }
    }

    @ReactMethod
    fun getInitialNotification(promise: Promise) {
        val chat = NotificationInbox.consume()
        promise.resolve(
            if (chat == null) null else Arguments.createMap().apply { putString("chat", chat) }
        )
    }

    @ReactMethod
    fun showNotification(title: String, text: String, chat: String?, promise: Promise) =
        async(promise) { PushNotifications.show(context, title, chat) }

    @ReactMethod fun getPushToken(promise: Promise) = PushClient.getToken(promise)

    @ReactMethod
    fun reconcilePushAccount(userId: Double?, promise: Promise) =
        async(promise) {
            require(
                userId == null ||
                    (userId > 0 && userId % 1.0 == 0.0 && userId <= 9007199254740991.0)
            )
            PushNotifications.reconcileAccount(context, userId?.toLong())
            true
        }

    @ReactMethod
    fun setPushContext(
        userId: Double?,
        enabled: Boolean,
        mutedChatKeys: com.facebook.react.bridge.ReadableArray,
        activeChatKey: String?,
        promise: Promise,
    ) =
        async(promise) {
            require(
                userId == null ||
                    (userId > 0 && userId % 1.0 == 0.0 && userId <= 9007199254740991.0)
            )
            val muted =
                (0 until mutedChatKeys.size()).mapNotNull { mutedChatKeys.getString(it) }.toSet()
            PushNotifications.setContext(context, userId?.toLong(), enabled, muted, activeChatKey)
            true
        }

    @ReactMethod fun readFile(uri: String, promise: Promise) = files.readFile(uri, promise)

    @ReactMethod
    fun writeCacheFile(name: String, value: String, mime: String, promise: Promise) =
        files.writeCacheFile(name, value, mime, promise)

    @ReactMethod
    fun deleteCacheFile(uri: String, promise: Promise) = files.deleteCacheFile(uri, promise)

    @ReactMethod
    fun shareFile(uri: String, mime: String, promise: Promise) = files.shareFile(uri, mime, promise)

    @ReactMethod
    fun copyText(text: String, promise: Promise) {
        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(
            ClipData.newPlainText("PlayTime", text)
        )
        promise.resolve(true)
    }

    @ReactMethod fun startVoiceRecording(promise: Promise) = voiceRecorder.start(120.0, promise)

    @ReactMethod
    fun startVoiceRecordingWithLimit(maxSeconds: Double, promise: Promise) =
        voiceRecorder.start(maxSeconds, promise)

    @ReactMethod fun stopVoiceRecording(promise: Promise) = voiceRecorder.stop(promise)

    @ReactMethod
    fun cancelVoiceRecording(promise: Promise) {
        voiceRecorder.cancel()
        promise.resolve(true)
    }

    @ReactMethod fun playAudio(uri: String, promise: Promise) = voicePlayer.play(uri, promise)

    @ReactMethod
    fun pauseAudio(promise: Promise) {
        promise.resolve(voicePlayer.pause())
    }

    @ReactMethod
    fun resumeAudio(promise: Promise) {
        promise.resolve(voicePlayer.resume())
    }

    @ReactMethod
    fun seekAudio(positionMs: Double, promise: Promise) {
        promise.resolve(voicePlayer.seek(positionMs))
    }

    @ReactMethod
    fun getAudioProgress(promise: Promise) {
        promise.resolve(voicePlayer.progress())
    }

    @ReactMethod
    fun stopAudio(promise: Promise) {
        voicePlayer.stop()
        promise.resolve(true)
    }

    @ReactMethod
    fun setAutomaticAudioRecording(enabled: Boolean, promise: Promise) {
        com.oney.WebRTCModule.WebRTCModule.playTimeExecute {
            try {
                checkNotNull(
                        context.getNativeModule(com.oney.WebRTCModule.WebRTCModule::class.java)
                    )
                    .playTimeSetAutomaticAudioRecording(enabled)
                promise.resolve(true)
            } catch (error: Exception) {
                promise.reject(
                    "AUDIO_ROUTING_FAILED",
                    "Не удалось переключить источник звука",
                    error,
                )
            }
        }
    }

    @ReactMethod
    fun configureScreenCapture(
        videoTrackId: String,
        targetLongSide: Double,
        maxFps: Double,
        promise: Promise,
    ) {
        com.oney.WebRTCModule.WebRTCModule.playTimeExecute {
            try {
                require(targetLongSide.isFinite() && maxFps.isFinite())
                checkNotNull(
                        context.getNativeModule(com.oney.WebRTCModule.WebRTCModule::class.java)
                    )
                    .playTimeConfigureScreenCapture(
                        videoTrackId,
                        targetLongSide.toInt(),
                        maxFps.toInt(),
                    )
                promise.resolve(true)
            } catch (error: Exception) {
                promise.reject(
                    "SCREEN_QUALITY_FAILED",
                    "Не удалось применить качество экрана",
                    error,
                )
            }
        }
    }

    @ReactMethod
    fun startSystemAudioShare(videoTrackId: String, promise: Promise) =
        systemAudio.start(videoTrackId, promise)

    @ReactMethod fun stopSystemAudioShare(promise: Promise) = systemAudio.stop(promise)

    @ReactMethod
    fun startCallRinging(incoming: Boolean, promise: Promise) {
        try {
            if (context.lifecycleState != com.facebook.react.common.LifecycleState.RESUMED) {
                promise.resolve(false)
                return
            }
            callRinger.start(incoming)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("RINGTONE_FAILED", "Не удалось включить мелодию звонка", error)
        }
    }

    @ReactMethod
    fun stopCallRinging(promise: Promise) {
        callRinger.stop()
        promise.resolve(true)
    }

    @ReactMethod
    fun startCallAudio(speaker: Boolean, promise: Promise) {
        if (
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            promise.reject("MICROPHONE_PERMISSION", "Разрешите доступ к микрофону")
            return
        }
        try {
            if (voiceRecorder.isRecording) {
                voiceRecorder.cancel()
                emit("PlayTimeRecordingInterrupted", Arguments.createMap())
            }
            voicePlayer.stop()
            emit(
                "PlayTimeAudioStopped",
                Arguments.createMap().apply { putString("reason", "call") },
            )
            if (!callActive) {
                oldAudioMode = audio.mode
                oldSpeaker = legacySpeakerphoneEnabled()
                val attributes =
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                val result =
                    if (Build.VERSION.SDK_INT >= 26) {
                        val request =
                            AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                                .setAudioAttributes(attributes)
                                .setOnAudioFocusChangeListener(focusListener)
                                .build()
                        focusRequest = request
                        audio.requestAudioFocus(request)
                    } else {
                        @Suppress("DEPRECATION")
                        audio.requestAudioFocus(
                            focusListener,
                            AudioManager.STREAM_VOICE_CALL,
                            AudioManager.AUDIOFOCUS_GAIN,
                        )
                    }
                if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
                    throw IllegalStateException("Другой звонок использует звук")
                callActive = true
                audio.mode = AudioManager.MODE_IN_COMMUNICATION
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, CallAudioService::class.java),
                )
            }
            routeSpeaker(speaker)
            promise.resolve(true)
        } catch (error: Exception) {
            stopCallAudioInternal()
            promise.reject("CALL_AUDIO_FAILED", "Не удалось включить звук звонка", error)
        }
    }

    private fun updateProximity(useEarpiece: Boolean) {
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return
        if (useEarpiece && callActive) {
            if (proximityLock == null)
                proximityLock =
                    power.newWakeLock(
                        PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK,
                        "PlayTime:CallProximity",
                    )
            if (proximityLock?.isHeld != true) proximityLock?.acquire(4 * 60 * 60 * 1000L)
        } else if (proximityLock?.isHeld == true) proximityLock?.release()
    }

    @Suppress("DEPRECATION")
    private fun legacySpeakerphoneEnabled(): Boolean = audio.isSpeakerphoneOn

    @Suppress("DEPRECATION")
    private fun setLegacySpeakerphone(enabled: Boolean) {
        audio.isSpeakerphoneOn = enabled
    }

    private fun routeSpeaker(enabled: Boolean) {
        if (Build.VERSION.SDK_INT >= 31) {
            val type =
                if (enabled) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
            val device = audio.availableCommunicationDevices.firstOrNull { it.type == type }
            if (device != null) {
                check(audio.setCommunicationDevice(device)) { "Устройство вывода недоступно" }
                updateProximity(device.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
            } else {
                audio.clearCommunicationDevice()
                updateProximity(false)
            }
        } else {
            setLegacySpeakerphone(enabled)
            updateProximity(!enabled)
        }
    }

    @ReactMethod
    fun setSpeakerphone(enabled: Boolean, promise: Promise) {
        try {
            routeSpeaker(enabled)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("AUDIO_ROUTE", "Не удалось переключить звук", error)
        }
    }

    @ReactMethod
    fun getAudioRoutes(promise: Promise) {
        try {
            val list = Arguments.createArray()
            if (Build.VERSION.SDK_INT >= 31)
                audio.availableCommunicationDevices.forEach { device ->
                    val type =
                        when (device.type) {
                            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
                            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
                            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                            AudioDeviceInfo.TYPE_BLE_HEADSET -> "bluetooth"
                            else -> "headset"
                        }
                    list.pushMap(
                        Arguments.createMap().apply {
                            putString("id", device.id.toString())
                            putString(
                                "name",
                                when (type) {
                                    "speaker" -> "Динамик"
                                    "earpiece" -> "Телефон"
                                    else -> device.productName.toString()
                                },
                            )
                            putString("type", type)
                        }
                    )
                }
            else {
                list.pushMap(
                    Arguments.createMap().apply {
                        putString("id", "speaker")
                        putString("name", "Динамик")
                        putString("type", "speaker")
                    }
                )
                list.pushMap(
                    Arguments.createMap().apply {
                        putString("id", "earpiece")
                        putString("name", "Телефон")
                        putString("type", "earpiece")
                    }
                )
            }
            promise.resolve(list)
        } catch (error: Exception) {
            promise.reject(
                "AUDIO_ROUTE",
                "Разрешите доступ к Bluetooth для выбора гарнитуры",
                error,
            )
        }
    }

    @ReactMethod
    fun selectAudioRoute(id: String, promise: Promise) {
        try {
            val result =
                if (Build.VERSION.SDK_INT >= 31)
                    audio.availableCommunicationDevices
                        .firstOrNull { it.id.toString() == id }
                        ?.let {
                            val selected = audio.setCommunicationDevice(it)
                            if (selected)
                                updateProximity(it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
                            selected
                        } ?: false
                else {
                    routeSpeaker(id == "speaker")
                    true
                }
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject("AUDIO_ROUTE", "Не удалось выбрать устройство", error)
        }
    }

    @ReactMethod
    fun stopCallAudio(promise: Promise) {
        stopCallAudioInternal()
        promise.resolve(true)
    }

    private fun stopCallAudioInternal() {
        updateProximity(false)
        val wasActive = callActive
        callActive = false
        runCatching { if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice() }
        if (wasActive) {
            runCatching { audio.mode = oldAudioMode }
            runCatching { setLegacySpeakerphone(oldSpeaker) }
        }
        runCatching {
            if (Build.VERSION.SDK_INT >= 26)
                focusRequest?.let { audio.abandonAudioFocusRequest(it) }
            else {
                @Suppress("DEPRECATION") audio.abandonAudioFocus(focusListener)
            }
        }
        focusRequest = null
        runCatching { context.stopService(Intent(context, CallAudioService::class.java)) }
    }

    @ReactMethod
    fun sha256Base64(value: String, promise: Promise) =
        async(promise) { KeyBackupCrypto.sha256Base64(value) }

    @ReactMethod
    fun encryptKeyBackup(userId: Double, keysJson: String, password: String, promise: Promise) =
        async(promise) { KeyBackupCrypto.encrypt(userId, keysJson, password) }

    @ReactMethod
    fun decryptKeyBackup(source: String, userId: Double, password: String, promise: Promise) =
        async(promise) { KeyBackupCrypto.decrypt(source, userId, password) }

    override fun onHostResume() = Unit

    override fun onHostPause() {
        callRinger.stop()
        if (voiceRecorder.isRecording) {
            voiceRecorder.cancel()
            emit("PlayTimeRecordingInterrupted", Arguments.createMap())
        }
    }

    override fun onHostDestroy() {
        voiceRecorder.cancel()
        voicePlayer.stop()
    }

    override fun invalidate() {
        systemAudio.stop()
        callRinger.stop()
        voiceRecorder.cancel()
        voicePlayer.stop()
        stopCallAudioInternal()
        files.close()
        CallAudioEvents.onEndRequested = null
        PushClient.onTokenChanged = null
        context.removeActivityEventListener(this)
        context.removeLifecycleEventListener(this)
        worker.shutdown()
        super.invalidate()
    }
}
