package com.playtimemobile

import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okio.Buffer
import okio.ForwardingSink
import okio.buffer
import okio.sink

internal class MediaUploadBody private constructor(private val file: File, val body: RequestBody) :
    AutoCloseable {
    override fun close() {
        file.delete()
    }

    companion object {
        private const val MAX_BYTES = 33L * 1024 * 1024

        fun prepare(
            directory: File,
            source: RequestBody,
            canceled: () -> Boolean = { false },
        ): MediaUploadBody {
            check(directory.exists() || directory.mkdirs()) { "Upload cache is unavailable" }
            val file = File.createTempFile("encrypted-", ".multipart", directory)
            try {
                val bounded =
                    object : ForwardingSink(file.sink()) {
                        private var written = 0L

                        override fun write(source: Buffer, byteCount: Long) {
                            if (canceled()) throw InterruptedIOException("Canceled")
                            written += byteCount
                            if (written > MAX_BYTES)
                                throw IOException("Encrypted upload exceeds local limit")
                            super.write(source, byteCount)
                        }
                    }
                bounded.buffer().use { source.writeTo(it) }
                return MediaUploadBody(file, file.asRequestBody(source.contentType()))
            } catch (error: Throwable) {
                file.delete()
                throw error
            }
        }
    }
}
