const fs = require("node:fs/promises")
const path = require("node:path")
const { app, ipcMain, safeStorage } = require("electron")
const { isMainWindowSender } = require("./ipc-security")

function validateKeys(keys) {
    if (!keys || typeof keys !== "object" || Array.isArray(keys) || Object.keys(keys).length > 2000) throw new Error("Invalid key vault")
    for (const [name, value] of Object.entries(keys)) {
        if (!/^(dm|room:[1-9]\d*(?::[1-9]\d*)?)$/.test(name) || typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("Invalid encryption key")
    }
}

function registerKeyVault() {
    const queues = new Map()
    const guard = async (event, userId) => {
        if (!isMainWindowSender(event) || event.senderFrame !== event.sender.mainFrame || !Number.isSafeInteger(userId) || userId <= 0) throw new Error("Unauthorized key vault request")
        if (!(await safeStorage.isAsyncEncryptionAvailable()) || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) throw new Error("Системное хранилище ключей недоступно. Разрешите доступ к связке ключей ОС.")
        return path.join(app.getPath("userData"), `keys-${userId}.enc`)
    }
    ipcMain.handle("keys:read", async (event, userId) => {
        const file = await guard(event, userId)
        await queues.get(userId)
        let bytes
        try { bytes = await fs.readFile(file) } catch (error) { if (error.code === "ENOENT") return {}; throw error }
        const decrypted = await safeStorage.decryptStringAsync(bytes)
        const keys = JSON.parse(decrypted.result)
        validateKeys(keys)
        return keys
    })
    ipcMain.handle("keys:write", async (event, userId, keys) => {
        const file = await guard(event, userId)
        validateKeys(keys)
        const write = (queues.get(userId) || Promise.resolve()).catch(() => {}).then(async () => {
            const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(keys))
            const temporary = file + ".tmp"
            await fs.writeFile(temporary, encrypted, { mode: 0o600 })
            await fs.rename(temporary, file)
        })
        queues.set(userId, write)
        try { await write } finally { if (queues.get(userId) === write) queues.delete(userId) }
    })
}

module.exports = { registerKeyVault, validateKeys }
