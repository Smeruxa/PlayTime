import assert from "node:assert/strict"
import test from "node:test"
import crypto from "node:crypto"
import nacl from "tweetnacl"
import util from "tweetnacl-util"
import { decryptKeyBackup, encryptKeyBackup } from "../../apps/frontend/src/features/chat/keyBackup"
import { isRecoveryCodeFormat, matchesRecoveryCode, newRecoveryCode, recoveryCodeHash } from "../../apps/auth-api/auth/recoveryCode"

const keys = {
    dm: util.encodeBase64(nacl.randomBytes(32)),
    "room:5": util.encodeBase64(nacl.randomBytes(32)),
    "room:5:3": util.encodeBase64(nacl.randomBytes(32))
}
const password = "a long backup passphrase 2026"
test("encrypted backup restores keys only with its password and account", async () => {
    const source = await encryptKeyBackup(42, keys, password)
    assert.ok(!source.includes(keys.dm))
    assert.deepEqual(await decryptKeyBackup(source, 42, password), keys)
    await assert.rejects(decryptKeyBackup(source, 42, "a wrong backup password"), /Не удалось открыть/)
    await assert.rejects(decryptKeyBackup(source, 43, password), /другому аккаунту/)
    const tampered = JSON.parse(source)
    tampered.ciphertext = (tampered.ciphertext[0] === "A" ? "B" : "A") + tampered.ciphertext.slice(1)
    await assert.rejects(decryptKeyBackup(JSON.stringify(tampered), 42, password))
})
test("backup rejects short passwords and invalid keys", async () => {
    await assert.rejects(encryptKeyBackup(42, keys, "short"))
    await assert.rejects(encryptKeyBackup(42, { dm: "not-a-key" }, password))
    await assert.rejects(decryptKeyBackup("x".repeat(256001), 42, password))
})
test("new emailed codes use the unbiased six-digit random range and preserve leading zeroes", (t) => {
    let sample = 0
    t.mock.method(crypto, "randomInt", ((min: number, max: number) => {
        assert.equal(min, 0)
        assert.equal(max, 1_000_000)
        return sample
    }) as typeof crypto.randomInt)
    for (const [number, expected] of [[0, "000000"], [1, "000001"], [12345, "012345"], [999999, "999999"]] as const) {
        sample = number
        assert.equal(newRecoveryCode(), expected)
        assert.match(newRecoveryCode(), /^\d{6}$/)
    }
})
test("numeric codes and legacy in-flight hashes remain bound to their server purpose", () => {
    const code = "012345"
    const hash = recoveryCodeHash(code, "test-secret")
    assert.ok(!hash.includes(code))
    assert.equal(matchesRecoveryCode(code.toLowerCase(), hash, "test-secret"), true)
    assert.equal(matchesRecoveryCode(code, hash, "another-secret"), false)
    assert.equal(matchesRecoveryCode("wrong", hash, "test-secret"), false)
    const legacyHash = recoveryCodeHash("ABCDEF1234", "test-secret")
    assert.equal(matchesRecoveryCode("abcdef1234", legacyHash, "test-secret"), true)
    assert.equal(matchesRecoveryCode("ABCDEF1234", hash, "test-secret"), false)
    assert.equal(matchesRecoveryCode(code, hash, "test-secret:email-verification"), false)
    for (const invalid of ["12a345", "12345", "1234567", "１２３４５６", "GGGGGG1234", 123456, null]) {
        assert.equal(isRecoveryCodeFormat(invalid), false)
        if (typeof invalid === "string") assert.equal(matchesRecoveryCode(invalid, hash, "test-secret"), false)
    }
})
