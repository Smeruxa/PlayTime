package com.playtimemobile

import android.os.Build
import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

internal object KeyBackupCrypto {
    private fun base64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun unbase64(value: String) = Base64.decode(value, Base64.NO_WRAP)

    fun sha256Base64(value: String): String = run {
        require(value.length <= 1024 * 1024) { "Слишком большой вход" }
        MessageDigest.getInstance("SHA-256").digest(unbase64(value)).joinToString("") {
            "%02x".format(it.toInt() and 255)
        }
    }

    private fun validateKeys(keys: JSONObject) {
        require(keys.has("dm") && keys.length() <= 2000) { "В копии нет ключа переписки" }
        for (name in keys.keys()) {
            val value = keys.get(name)
            require(
                Regex("^(dm|room:[1-9]\\d*(?::[1-9]\\d*)?)$").matches(name) &&
                    value is String &&
                    value.length == 44 &&
                    unbase64(value).size == 32
            ) {
                "Некорректная копия ключей"
            }
        }
    }

    private fun backupKey(password: String, salt: ByteArray): SecretKeySpec {
        require(password.length >= 12) {
            "Для копии используйте пароль длиной не менее 12 символов"
        }
        if (Build.VERSION.SDK_INT < 26) {
            val passwordBytes = password.toByteArray(Charsets.UTF_8)
            val mac = Mac.getInstance("HmacSHA256")
            try {
                mac.init(SecretKeySpec(passwordBytes, "HmacSHA256"))
                var block = mac.doFinal(salt + byteArrayOf(0, 0, 0, 1))
                val output = block.copyOf()
                repeat(599999) {
                    val previous = block
                    block = mac.doFinal(previous)
                    previous.fill(0)
                    output.indices.forEach { index ->
                        output[index] = (output[index].toInt() xor block[index].toInt()).toByte()
                    }
                }
                block.fill(0)
                return SecretKeySpec(output, "AES").also { output.fill(0) }
            } finally {
                passwordBytes.fill(0)
            }
        }
        val spec = PBEKeySpec(password.toCharArray(), salt, 600000, 256)
        try {
            val bytes =
                SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            return SecretKeySpec(bytes, "AES").also { bytes.fill(0) }
        } finally {
            spec.clearPassword()
        }
    }

    fun encrypt(userId: Double, keysJson: String, password: String): String = run {
        require(userId > 0 && userId == userId.toLong().toDouble()) { "Некорректный аккаунт" }
        require(keysJson.length <= 200000) { "Копия слишком большая" }
        val keys = JSONObject(keysJson)
        validateKeys(keys)
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, backupKey(password, salt), GCMParameterSpec(128, iv))
        val plaintext =
            JSONObject()
                .put("userId", userId.toLong())
                .put("keys", keys)
                .toString()
                .toByteArray(Charsets.UTF_8)
        val ciphertext =
            try {
                cipher.doFinal(plaintext)
            } finally {
                plaintext.fill(0)
            }
        JSONObject()
            .put("format", "playtime-key-backup-v1")
            .put("salt", base64(salt))
            .put("iv", base64(iv))
            .put("ciphertext", base64(ciphertext))
            .toString()
    }

    fun decrypt(source: String, userId: Double, password: String): String = run {
        require(source.length <= 256000) { "Файл копии слишком большой" }
        try {
            val file = JSONObject(source)
            require(file.getString("format") == "playtime-key-backup-v1")
            val salt = unbase64(file.getString("salt"))
            val iv = unbase64(file.getString("iv"))
            require(salt.size == 16 && iv.size == 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                backupKey(password, salt),
                GCMParameterSpec(128, iv),
            )
            val plaintext = cipher.doFinal(unbase64(file.getString("ciphertext")))
            val payload =
                try {
                    JSONObject(String(plaintext, Charsets.UTF_8))
                } finally {
                    plaintext.fill(0)
                }
            if (payload.getDouble("userId") != userId)
                throw IllegalArgumentException("Эта копия принадлежит другому аккаунту")
            val keys = payload.getJSONObject("keys")
            validateKeys(keys)
            keys.toString()
        } catch (error: Exception) {
            if (error.message == "Эта копия принадлежит другому аккаунту") throw error
            throw IllegalArgumentException("Не удалось открыть копию: проверьте пароль и файл")
        }
    }
}
