import assert from "node:assert/strict"
import test from "node:test"
import { MAX_VOICE_PACKET_BYTES, isValidVoicePayload, normalizeVoicePayload, voicePayloadByteLength } from "../../apps/room-api/media/voicePacket"
import { packetByteLength } from "../../apps/gateway/packetBytes"
import { installSocketBudget } from "../../apps/gateway/socketBudget"

test("voice payloads accept binary views at their real byte boundaries", () => {
    for (const data of [Buffer.alloc(16), new ArrayBuffer(16), new Uint16Array(8), new DataView(new ArrayBuffer(16))]) {
        assert.equal(isValidVoicePayload(data), true)
        assert.equal(voicePayloadByteLength(data), 16)
    }
    assert.equal(isValidVoicePayload(Buffer.alloc(MAX_VOICE_PACKET_BYTES)), true)
    assert.equal(isValidVoicePayload(Buffer.alloc(MAX_VOICE_PACKET_BYTES + 1)), false)
    assert.equal(isValidVoicePayload(new Uint16Array(MAX_VOICE_PACKET_BYTES)), false)
})

test("voice payloads reject forged lengths, JSON buffer objects and nonbinary input", () => {
    for (const data of [
        null, undefined, "audio", [1, 2], Buffer.alloc(0), new ArrayBuffer(0),
        { length: 1, padding: "untrusted" }, { byteLength: 1, length: 1 },
        { type: "Buffer", data: [1, 2] }, { length: "1" }, { byteLength: NaN }
    ]) {
        assert.equal(isValidVoicePayload(data), false)
        assert.equal(normalizeVoicePayload(data), null)
    }
})

test("normalization preserves only the selected binary bytes and strips extra properties", () => {
    const source = Buffer.from([1, 2, 3, 4]) as Buffer & { padding?: string }
    source.padding = "untrusted"
    const normalized = normalizeVoicePayload(source) as Buffer & { padding?: string }
    assert.deepEqual([...normalized], [1, 2, 3, 4])
    assert.equal(normalized.padding, undefined)
    source[0] = 99
    assert.equal(normalized[0], 1)
    const view = new DataView(Uint8Array.from([0, 5, 6, 0]).buffer, 1, 2)
    assert.deepEqual([...normalizeVoicePayload(view)!], [5, 6])
})

test("media byte accounting includes extra fields, UTF-8, and binary attachments even beside a frame", () => {
    const packet = ["party:voice:broadcast", { frame: "x", voiceData: Buffer.alloc(1024), extra: "я".repeat(100) }]
    assert(packetByteLength(packet) >= 1024 + 200)
    const forged = ["party:voice:broadcast", { voiceData: { length: 1, padding: "x".repeat(1024) } }]
    assert(packetByteLength(forged) >= Buffer.byteLength(JSON.stringify(forged)))
    assert.equal(packetByteLength([() => {}]), 2)
})

test("media byte accounting rejects pathological nesting instead of walking indefinitely", () => {
    const cyclic: unknown[] = []
    cyclic.push(cyclic)
    assert.equal(packetByteLength(cyclic), Infinity)
    assert.equal(packetByteLength([Array(10_001).fill(0)]), Infinity)
})

test("socket byte budget charges serialized padding instead of the claimed voice length", t => {
    t.mock.method(Date, "now", () => 1000)
    let middleware: (packet: any[], next: (error?: Error) => void) => void = () => assert.fail("missing middleware")
    let disconnected = () => {}
    const socket = {
        id: "voice-packet-security-test",
        once(_event: string, callback: () => void) { disconnected = callback },
        use(callback: typeof middleware) { middleware = callback },
        disconnect() { assert.fail("a few rejected packets must not disconnect the socket") }
    }
    assert.equal(installSocketBudget(socket as any, 917001), true)
    t.after(() => disconnected())
    const packet = ["party:voice:broadcast", { voiceData: { length: 1, padding: "x".repeat(4 * 1024 ** 2) } }]
    const results: (Error | undefined)[] = []
    for (let n = 0; n < 4; n++) middleware(packet, error => results.push(error))
    assert.deepEqual(results.slice(0, 3), [undefined, undefined, undefined])
    assert.equal(results[3]?.message, "Rate limited")
})
