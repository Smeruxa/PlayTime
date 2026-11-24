package com.playtimemobile

import android.util.Log
import java.io.IOException
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.OkHttpClient

internal object NetworkDiagnostics {
    fun configure(builder: OkHttpClient.Builder) {
        builder.eventListenerFactory { call ->
            val route =
                when {
                    call.request().url.encodedPath.endsWith("/voice/upload") -> "voice/upload"
                    call.request().url.encodedPath.endsWith("/media/upload") -> "media/upload"
                    else -> "other"
                }
            object : EventListener() {
                override fun callFailed(call: Call, ioe: IOException) {
                    val types =
                        generateSequence<Throwable>(ioe) { it.cause }
                            .take(4)
                            .joinToString(" <- ") { it.javaClass.simpleName }
                    val reason =
                        when {
                            ioe.message?.contains("closed", ignoreCase = true) == true -> "closed"
                            ioe.message?.contains("canceled", ignoreCase = true) == true ->
                                "canceled"
                            ioe.message?.contains("stream", ignoreCase = true) == true -> "stream"
                            ioe.message?.contains("timeout", ignoreCase = true) == true -> "timeout"
                            else -> "unspecified"
                        }
                    Log.w(
                        "PlayTimeNetwork",
                        "${call.request().method} $route failed $types [$reason]",
                    )
                    ioe.stackTrace.take(8).forEach { frame ->
                        Log.w(
                            "PlayTimeNetwork",
                            "  ${frame.className}.${frame.methodName}:${frame.lineNumber}",
                        )
                    }
                }
            }
        }
    }
}
