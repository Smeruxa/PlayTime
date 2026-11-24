package com.playtimemobile

import android.content.Context
import android.net.Uri
import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.File

internal object PlayTimeHttpClient {
    fun install(context: Context) {
        val directory = File(context.cacheDir, "encrypted-uploads")
        directory.listFiles()?.filter { it.isFile }?.forEach { it.delete() }
        val base = Uri.parse(BuildConfig.API_BASE)
        val uploadPaths =
            setOf(
                "${base.path.orEmpty().trimEnd('/')}/voice/upload",
                "${base.path.orEmpty().trimEnd('/')}/attachments/upload",
            )
        OkHttpClientProvider.setOkHttpClientFactory {
            val builder = OkHttpClientProvider.createClientBuilder(context.applicationContext)
            builder.addInterceptor { chain ->
                val request = chain.request()
                val body = request.body
                if (
                    request.method != "POST" ||
                        request.url.host != base.host ||
                        request.url.encodedPath !in uploadPaths ||
                        body == null
                ) {
                    chain.proceed(request)
                } else {
                    MediaUploadBody.prepare(directory, body) { chain.call().isCanceled() }
                        .use { prepared ->
                            chain.proceed(
                                request.newBuilder().method(request.method, prepared.body).build()
                            )
                        }
                }
            }
            NetworkDiagnostics.configure(builder)
            builder.build()
        }
    }
}
