package com.playtimemobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KeyBackupInteropTest {
    private val fixture =
        InstrumentationRegistry.getInstrumentation()
            .context
            .assets
            .open("desktop-key-backup.json")
            .bufferedReader()
            .use { JSONObject(it.readText()) }
    private val password = fixture.getString("password")
    private val backup = fixture.getJSONObject("backup").toString()
    private val keys = fixture.getJSONObject("keys")

    @Test
    fun decryptsDesktopBackupWithUnicodePassword() {
        val decrypted = JSONObject(KeyBackupCrypto.decrypt(backup, 42.0, password))
        assertEquals(keys.getString("dm"), decrypted.getString("dm"))
        assertEquals(keys.getString("room:17"), decrypted.getString("room:17"))
        assertEquals(2, decrypted.length())
    }

    @Test
    fun fingerprintMatchesDesktopSha256OfDecodedPublicKey() {
        assertEquals(
            fixture.getString("fingerprint"),
            KeyBackupCrypto.sha256Base64(keys.getString("dm")),
        )
    }

    @Test
    fun rejectsAnotherAccountsBackup() {
        val error =
            assertThrows(IllegalArgumentException::class.java) {
                KeyBackupCrypto.decrypt(backup, 43.0, password)
            }
        assertEquals("Эта копия принадлежит другому аккаунту", error.message)
    }

    @Test
    fun rejectsWrongPasswordAndTamperedCiphertext() {
        assertThrows(IllegalArgumentException::class.java) {
            KeyBackupCrypto.decrypt(backup, 42.0, "incorrect-password")
        }
        val corrupted = JSONObject(backup)
        val ciphertext = corrupted.getString("ciphertext")
        corrupted.put("ciphertext", (if (ciphertext[0] == 'A') "B" else "A") + ciphertext.drop(1))
        assertThrows(IllegalArgumentException::class.java) {
            KeyBackupCrypto.decrypt(corrupted.toString(), 42.0, password)
        }
    }

    @Test
    fun encryptsWithFreshSaltAndIvAndRoundTripsEveryKey() {
        val first = JSONObject(KeyBackupCrypto.encrypt(42.0, keys.toString(), password))
        val second = JSONObject(KeyBackupCrypto.encrypt(42.0, keys.toString(), password))
        assertEquals("playtime-key-backup-v1", first.getString("format"))
        assertNotEquals(first.getString("salt"), second.getString("salt"))
        assertNotEquals(first.getString("iv"), second.getString("iv"))
        assertFalse(first.toString().contains(keys.getString("dm")))
        val decrypted = JSONObject(KeyBackupCrypto.decrypt(first.toString(), 42.0, password))
        assertEquals(keys.getString("dm"), decrypted.getString("dm"))
        assertEquals(keys.getString("room:17"), decrypted.getString("room:17"))
    }

    @Test
    fun refusesMalformedKeysAndWeakPasswordBeforeExport() {
        val invalidKeys = JSONObject(keys.toString()).put("room:0", keys.getString("dm"))
        assertThrows(IllegalArgumentException::class.java) {
            KeyBackupCrypto.encrypt(42.0, invalidKeys.toString(), password)
        }
        assertThrows(IllegalArgumentException::class.java) {
            KeyBackupCrypto.encrypt(42.0, keys.toString(), "short")
        }
        assertThrows(IllegalArgumentException::class.java) {
            KeyBackupCrypto.encrypt(0.0, keys.toString(), password)
        }
    }
}
