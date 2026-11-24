package com.playtimemobile

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.util.UUID

internal class NativeFiles(
    private val context: ReactApplicationContext,
    private val async: (Promise, () -> Any?) -> Unit,
) {
    private var pickerPromise: Promise? = null
    private var pickingImage = false
    private var exportPromise: Promise? = null
    private var exportBytes: ByteArray? = null

    init {
        sharedDirectory()
            .listFiles()
            ?.filter { System.currentTimeMillis() - it.lastModified() > 24 * 60 * 60 * 1000L }
            ?.forEach { it.delete() }
    }

    fun sharedDirectory(): File = File(context.cacheDir, "shared").apply { mkdirs() }

    private fun safeName(name: String) =
        name
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .replace(Regex("[^\\p{L}\\p{N}._ -]"), "_")
            .take(150)
            .ifBlank { "file" }

    private fun base64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun unbase64(value: String) = Base64.decode(value, Base64.NO_WRAP)

    private fun input(uri: String): InputStream {
        val parsed = Uri.parse(uri)
        return when (parsed.scheme) {
            "content" ->
                context.contentResolver.openInputStream(parsed)
                    ?: throw IllegalArgumentException("Файл недоступен")
            "file" -> File(parsed.path ?: "").inputStream()
            null -> File(uri).inputStream()
            else -> throw IllegalArgumentException("Ожидался локальный файл")
        }
    }

    private fun readBounded(uri: String, max: Int = 32 * 1024 * 1024): ByteArray =
        input(uri).use { stream ->
            val result = ByteArrayOutputStream()
            val buffer = ByteArray(16384)
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                if (result.size() + count > max)
                    throw IllegalArgumentException("Файл слишком большой: максимум 32 МБ")
                result.write(buffer, 0, count)
            }
            result.toByteArray()
        }

    fun fileMap(
        file: File,
        mime: String,
        bytes: ByteArray = file.readBytes(),
        name: String = file.name,
    ): WritableMap =
        Arguments.createMap().apply {
            putString("uri", Uri.fromFile(file).toString())
            putString("name", name)
            putString("mime", mime)
            putDouble("size", bytes.size.toDouble())
            putString("base64", base64(bytes))
        }

    fun pickFile(mime: String, promise: Promise) = pick(mime, false, promise)

    fun pickImage(promise: Promise) = pick("image/*", true, promise)

    private fun pick(mime: String, image: Boolean, promise: Promise) {
        val activity =
            context.currentActivity
                ?: run {
                    promise.reject("NO_ACTIVITY", "Откройте приложение для выбора файла")
                    return
                }
        if (pickerPromise != null) {
            promise.reject("PICKER_OPEN", "Выбор файла уже открыт")
            return
        }
        pickerPromise = promise
        pickingImage = image
        try {
            val intent =
                Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mime.ifBlank { "*/*" }
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
            activity.startActivityForResult(intent, 7210)
        } catch (error: Exception) {
            pickerPromise = null
            promise.reject("PICKER_FAILED", "Не удалось открыть выбор файла", error)
        }
    }

    fun saveDocument(name: String, value: String, mime: String, promise: Promise) {
        val activity =
            context.currentActivity
                ?: run {
                    promise.reject("NO_ACTIVITY", "Откройте приложение для сохранения файла")
                    return
                }
        if (exportPromise != null) {
            promise.reject("PICKER_OPEN", "Сохранение файла уже открыто")
            return
        }
        try {
            require(value.length <= 45 * 1024 * 1024) { "Файл слишком большой" }
            val bytes = unbase64(value)
            require(bytes.size <= 32 * 1024 * 1024) { "Файл слишком большой: максимум 32 МБ" }
            exportBytes = bytes
            exportPromise = promise
            activity.startActivityForResult(
                Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mime
                    putExtra(Intent.EXTRA_TITLE, safeName(name))
                },
                7211,
            )
        } catch (error: Exception) {
            exportPromise = null
            exportBytes?.fill(0)
            exportBytes = null
            promise.reject("SAVE_FAILED", "Не удалось открыть сохранение файла", error)
        }
    }

    fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
    ) {
        if (requestCode == 7211) {
            val promise = exportPromise ?: return
            val bytes = exportBytes
            exportPromise = null
            exportBytes = null
            val uri = data?.data
            if (resultCode != Activity.RESULT_OK || uri == null || bytes == null) {
                bytes?.fill(0)
                promise.resolve(null)
                return
            }
            async(promise) {
                try {
                    (context.contentResolver.openOutputStream(uri, "wt")
                            ?: throw IllegalArgumentException("Файл недоступен"))
                        .use { it.write(bytes) }
                    uri.toString()
                } finally {
                    bytes.fill(0)
                }
            }
            return
        }
        if (requestCode != 7210) return
        val promise = pickerPromise ?: return
        val image = pickingImage
        pickerPromise = null
        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            promise.resolve(null)
            return
        }
        val uri = data.data!!
        async(promise) {
            var name = "attachment"
            context.contentResolver
                .query(
                    uri,
                    arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                    null,
                    null,
                    null,
                )
                ?.use {
                    if (it.moveToFirst()) {
                        name = it.getString(0) ?: name
                        if (!it.isNull(1) && it.getLong(1) > 32 * 1024 * 1024)
                            throw IllegalArgumentException("Файл слишком большой: максимум 32 МБ")
                    }
                }
            val original = readBounded(uri.toString())
            val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
            if (image) {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(original, 0, original.size, bounds)
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0)
                    throw IllegalArgumentException("Не удалось прочитать изображение")
                val options =
                    BitmapFactory.Options().apply {
                        inSampleSize = 1
                        while (
                            bounds.outWidth / inSampleSize > 2048 ||
                                bounds.outHeight / inSampleSize > 2048
                        ) inSampleSize *= 2
                    }
                var bitmap =
                    BitmapFactory.decodeByteArray(original, 0, original.size, options)
                        ?: throw IllegalArgumentException("Не удалось прочитать изображение")
                val orientation = runCatching {
                    original.inputStream().use {
                        ExifInterface(it)
                            .getAttributeInt(
                                ExifInterface.TAG_ORIENTATION,
                                ExifInterface.ORIENTATION_NORMAL,
                            )
                    }
                }
                    .getOrDefault(1)
                val matrix =
                    Matrix().apply {
                        when (orientation) {
                            2 -> setScale(-1f, 1f)
                            3 -> setRotate(180f)
                            4 -> setScale(1f, -1f)
                            5 -> {
                                setRotate(90f)
                                postScale(-1f, 1f)
                            }
                            6 -> setRotate(90f)
                            7 -> {
                                setRotate(270f)
                                postScale(-1f, 1f)
                            }
                            8 -> setRotate(270f)
                        }
                    }
                if (!matrix.isIdentity) {
                    val rotated =
                        Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                    if (rotated != bitmap) bitmap.recycle()
                    bitmap = rotated
                }
                val scale = minOf(1f, 1024f / maxOf(bitmap.width, bitmap.height))
                if (scale < 1f) {
                    val resized =
                        Bitmap.createScaledBitmap(
                            bitmap,
                            (bitmap.width * scale).toInt().coerceAtLeast(1),
                            (bitmap.height * scale).toInt().coerceAtLeast(1),
                            true,
                        )
                    if (resized != bitmap) bitmap.recycle()
                    bitmap = resized
                }
                val output = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, 88, output)
                bitmap.recycle()
                val bytes = output.toByteArray()
                val file =
                    File(sharedDirectory(), UUID.randomUUID().toString() + ".jpg").apply {
                        writeBytes(bytes)
                    }
                fileMap(file, "image/jpeg", bytes, "photo.jpg").apply {
                    putString("dataUri", "data:image/jpeg;base64," + base64(bytes))
                }
            } else {
                val file =
                    File(sharedDirectory(), UUID.randomUUID().toString() + "-" + safeName(name))
                        .apply { writeBytes(original) }
                fileMap(file, mime, original, name)
            }
        }
    }

    fun readFile(uri: String, promise: Promise) = async(promise) { base64(readBounded(uri)) }

    fun writeCacheFile(name: String, value: String, mime: String, promise: Promise) =
        async(promise) {
            if (value.length > 45 * 1024 * 1024)
                throw IllegalArgumentException("Файл слишком большой")
            val file = File(sharedDirectory(), UUID.randomUUID().toString() + "-" + safeName(name))
            val bytes = unbase64(value)
            require(bytes.size <= 32 * 1024 * 1024) { "Файл слишком большой: максимум 32 МБ" }
            file.writeBytes(bytes)
            Uri.fromFile(file).toString()
        }

    fun deleteCacheFile(uri: String, promise: Promise) =
        async(promise) {
            val file =
                File(if (uri.startsWith("file:")) Uri.parse(uri).path ?: "" else uri).canonicalFile
            require(file.path.startsWith(sharedDirectory().canonicalPath + File.separator)) {
                "Разрешено удалять только временные файлы PlayTime"
            }
            !file.exists() || file.delete()
        }

    fun shareFile(uri: String, mime: String, promise: Promise) {
        try {
            val path = if (uri.startsWith("file:")) Uri.parse(uri).path ?: "" else uri
            val file = File(path).canonicalFile
            if (!file.path.startsWith(sharedDirectory().canonicalPath + File.separator))
                throw IllegalArgumentException("Разрешены только подготовленные вложения")
            val content =
                FileProvider.getUriForFile(context, "${BuildConfig.APPLICATION_ID}.files", file)
            val intent =
                Intent(Intent.ACTION_SEND).apply {
                    type = mime
                    putExtra(Intent.EXTRA_STREAM, content)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    clipData = ClipData.newRawUri("attachment", content)
                }
            val chooser =
                Intent.createChooser(intent, "Сохранить или поделиться")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(chooser)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("SHARE_FAILED", "Не удалось открыть вложение", error)
        }
    }

    fun close() {
        pickerPromise?.reject("ACTIVITY_DESTROYED", "Выбор файла прерван")
        pickerPromise = null
        exportPromise?.reject("ACTIVITY_DESTROYED", "Сохранение файла прервано")
        exportPromise = null
        exportBytes?.fill(0)
        exportBytes = null
    }
}
