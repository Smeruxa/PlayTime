package com.playtimemobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.util.UUID
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import okio.Buffer
import okio.BufferedSink
import okio.ForwardingSink
import okio.buffer
import okio.source
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MediaUploadBodyTest {
    private val directory =
        File(
            InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,
            "upload-test-${UUID.randomUUID()}",
        )
    private val content = ByteArray(20000) { (it % 251).toByte() }
    private var sourceWrites = 0

    private fun oneShot(): RequestBody {
        val input = ByteArrayInputStream(content)
        return object : RequestBody() {
            override fun contentType() = "multipart/form-data; boundary=playtime-test".toMediaType()

            override fun isOneShot() = true

            override fun writeTo(sink: BufferedSink) {
                sourceWrites++
                input.source().use { sink.writeAll(it) }
            }
        }
    }

    @After
    fun cleanup() {
        directory.deleteRecursively()
    }

    @Test
    fun writesIdenticalMultipartAcrossRetriesWithoutRereadingOriginalInput() {
        MediaUploadBody.prepare(directory, oneShot()).use { upload ->
            assertEquals(content.size.toLong(), upload.body.contentLength())
            assertEquals(
                "multipart/form-data; boundary=playtime-test",
                upload.body.contentType().toString(),
            )
            assertFalse(upload.body.isOneShot())
            repeat(2) {
                val sink = Buffer()
                upload.body.writeTo(sink)
                assertTrue(content.contentEquals(sink.readByteArray()))
            }
            assertEquals(1, sourceWrites)
        }
        assertTrue(directory.listFiles().orEmpty().isEmpty())
    }

    @Test
    fun socketFailureDoesNotLeaveTheNextAttemptWithAClosedStream() {
        MediaUploadBody.prepare(directory, oneShot()).use { upload ->
            val failed =
                object : ForwardingSink(Buffer()) {
                        override fun write(source: Buffer, byteCount: Long) {
                            throw IOException("Synthetic socket closed")
                        }
                    }
                    .buffer()
            val error = runCatching { upload.body.writeTo(failed) }.exceptionOrNull()
            assertTrue(error is IOException)
            val successful = Buffer()
            upload.body.writeTo(successful)
            assertTrue(content.contentEquals(successful.readByteArray()))
            assertEquals(1, sourceWrites)
        }
        assertTrue(directory.listFiles().orEmpty().isEmpty())
    }

    @Test
    fun cancellationDeletesPartialSpoolAndNeverCreatesAReusableBody() {
        val error = runCatching {
            MediaUploadBody.prepare(directory, oneShot()) { true }
        }
            .exceptionOrNull()
        assertTrue(error is IOException)
        assertTrue(directory.listFiles().orEmpty().isEmpty())
    }
}
