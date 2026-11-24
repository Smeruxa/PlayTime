package com.playtimemobile

import android.net.Uri
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReadableMap
import java.io.File
import java.util.UUID
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeFilesTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    @Suppress("DEPRECATION")
    private val files =
        NativeFiles(BridgeReactContext(context)) { promise, action ->
            try {
                promise.resolve(action())
            } catch (error: Exception) {
                promise.reject("TEST_NATIVE", error.message, error)
            }
        }

    private class Result {
        var value: Any? = null
        var error: String? = null
        val promise =
            PromiseImpl(
                Callback { args -> value = args.firstOrNull() },
                Callback { args ->
                    error = (args.firstOrNull() as? ReadableMap)?.getString("code")
                },
            )
    }

    @Test
    fun cacheFileSanitizesNameAndRoundTripsBinaryBytes() {
        val bytes = ByteArray(256) { it.toByte() }
        val written = Result()
        files.writeCacheFile(
            "../../binary:payload.bin",
            Base64.encodeToString(bytes, Base64.NO_WRAP),
            "application/octet-stream",
            written.promise,
        )
        assertNull(written.error)
        val uri = written.value as String
        val file = File(checkNotNull(Uri.parse(uri).path))
        try {
            assertEquals(files.sharedDirectory().canonicalPath, file.parentFile?.canonicalPath)
            assertFalse(file.name.contains(':'))
            val read = Result()
            files.readFile(uri, read.promise)
            assertNull(read.error)
            assertArrayEquals(bytes, Base64.decode(read.value as String, Base64.NO_WRAP))
            val deleted = Result()
            files.deleteCacheFile(uri, deleted.promise)
            assertEquals(true, deleted.value)
            assertFalse(file.exists())
        } finally {
            file.delete()
        }
    }

    @Test
    fun refusesDeletingOrSharingOutsidePreparedCache() {
        val sentinel = File(context.cacheDir, "native-test-${UUID.randomUUID()}")
        sentinel.writeText("must remain")
        try {
            val deleted = Result()
            files.deleteCacheFile(Uri.fromFile(sentinel).toString(), deleted.promise)
            assertNotNull(deleted.error)
            assertEquals("must remain", sentinel.readText())
            val shared = Result()
            files.shareFile(Uri.fromFile(sentinel).toString(), "text/plain", shared.promise)
            assertEquals("SHARE_FAILED", shared.error)
            assertTrue(sentinel.exists())
        } finally {
            sentinel.delete()
        }
    }

    @Test
    fun rejectsNetworkUriAndOversizedLocalFile() {
        val network = Result()
        files.readFile("https://example.invalid/private.txt", network.promise)
        assertNotNull(network.error)
        val oversized = File(context.cacheDir, "native-test-${UUID.randomUUID()}")
        try {
            oversized.outputStream().use { output ->
                val block = ByteArray(1024 * 1024)
                repeat(33) { output.write(block) }
            }
            val read = Result()
            files.readFile(Uri.fromFile(oversized).toString(), read.promise)
            assertNotNull(read.error)
            assertNull(read.value)
        } finally {
            oversized.delete()
        }
    }

    @Test
    fun documentPickerWithoutActivityFailsWithActionableCode() {
        val picked = Result()
        files.pickFile("application/pdf", picked.promise)
        assertEquals("NO_ACTIVITY", picked.error)
        val exported = Result()
        files.saveDocument("backup.json", "e30=", "application/json", exported.promise)
        assertEquals("NO_ACTIVITY", exported.error)
    }
}
