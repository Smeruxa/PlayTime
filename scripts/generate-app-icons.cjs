const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const { createRequire } = require("node:module")

const root = path.resolve(__dirname, "..")
const source = path.join(root, "apps/frontend/public/assets/PlayTime.png")
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const icnsSizes = {
    ic04: 16,
    ic05: 32,
    icp4: 16,
    icp5: 32,
    icp6: 64,
    ic07: 128,
    ic08: 256,
    ic09: 512,
    ic10: 1024,
    ic11: 32,
    ic12: 64,
    ic13: 256,
    ic14: 512
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex")
}

function srgbChunk() {
    const payload = Buffer.from([115, 82, 71, 66, 0])
    let crc = 0xffffffff
    for (const byte of payload) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    const chunk = Buffer.alloc(13)
    chunk.writeUInt32BE(1, 0)
    payload.copy(chunk, 4)
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 9)
    return chunk
}

function normalizePng(file) {
    const buffer = fs.readFileSync(file)
    pngDimensions(buffer)
    const chunks = [pngSignature]
    for (let offset = 8; offset < buffer.length; ) {
        const length = buffer.readUInt32BE(offset),
            end = offset + length + 12
        assert.ok(end <= buffer.length)
        const type = buffer.toString("ascii", offset + 4, offset + 8)
        if (["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(type)) chunks.push(buffer.subarray(offset, end))
        if (type === "IHDR") chunks.push(srgbChunk())
        offset = end
    }
    fs.writeFileSync(file, Buffer.concat(chunks))
}

function pngDimensions(buffer) {
    assert.ok(buffer.subarray(0, 8).equals(pngSignature), "Expected an actual PNG image")
    assert.equal(buffer.toString("ascii", 12, 16), "IHDR")
    assert.equal(buffer.readUInt32BE(8), 13)
    assert.equal(buffer[24], 8, "Expected 8-bit PNG samples")
    assert.ok([2, 6].includes(buffer[25]), "Expected RGB or RGBA PNG")
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function verifyPng(file, size) {
    const buffer = fs.readFileSync(file)
    assert.deepEqual(pngDimensions(buffer), { width: size, height: size }, `PNG dimensions: ${file}`)
    return buffer
}

function icoFrames(buffer) {
    assert.equal(buffer.readUInt16LE(0), 0)
    assert.equal(buffer.readUInt16LE(2), 1)
    const count = buffer.readUInt16LE(4)
    assert.ok(count > 0 && count <= 32)
    const frames = []
    for (let i = 0; i < count; i++) {
        const entry = 6 + i * 16
        const width = buffer[entry] || 256,
            height = buffer[entry + 1] || 256
        const length = buffer.readUInt32LE(entry + 8),
            offset = buffer.readUInt32LE(entry + 12)
        assert.ok(offset >= 6 + count * 16 && length > 0 && offset + length <= buffer.length)
        const image = buffer.subarray(offset, offset + length)
        let format
        if (image.subarray(0, 8).equals(pngSignature)) {
            assert.deepEqual(pngDimensions(image), { width, height })
            format = "png"
        } else {
            assert.equal(image.readUInt32LE(0), 40, "Expected a BITMAPINFOHEADER ICO frame")
            assert.equal(image.readInt32LE(4), width)
            assert.equal(image.readInt32LE(8), height * 2)
            assert.equal(image.readUInt16LE(12), 1)
            assert.equal(image.readUInt16LE(14), 32)
            format = "bmp32"
        }
        assert.equal(width, height)
        frames.push({ size: width, format })
    }
    assert.deepEqual(
        frames.map((frame) => frame.size).sort((a, b) => a - b),
        icoSizes
    )
    return frames
}

function icnsFrames(buffer) {
    assert.equal(buffer.toString("ascii", 0, 4), "icns")
    assert.equal(buffer.readUInt32BE(4), buffer.length)
    const frames = []
    let offset = 8
    while (offset < buffer.length) {
        const type = buffer.toString("ascii", offset, offset + 4),
            length = buffer.readUInt32BE(offset + 4)
        assert.ok(length > 8 && offset + length <= buffer.length)
        if (type !== "TOC ") {
            const size = icnsSizes[type]
            assert.ok(size, `Unknown ICNS frame type: ${type}`)
            const image = buffer.subarray(offset + 8, offset + length)
            if (type === "ic04" || type === "ic05") {
                assert.equal(image.toString("ascii", 0, 4), "ARGB")
                let position = 4
                for (let channel = 0; channel < 4; channel++) {
                    let pixels = 0
                    while (pixels < size * size) {
                        assert.ok(position < image.length, "Truncated ARGB channel")
                        const control = image[position++]
                        const repeated = control >= 128
                        const count = repeated ? control - 128 + 3 : control + 1
                        position += repeated ? 1 : count
                        pixels += count
                        assert.ok(position <= image.length && pixels <= size * size)
                    }
                }
                assert.equal(position, image.length)
                frames.push({ type, size, format: "argb-rle" })
            } else {
                assert.deepEqual(pngDimensions(image), { width: size, height: size })
                frames.push({ type, size, format: "png" })
            }
        }
        offset += length
    }
    assert.equal(offset, buffer.length)
    for (const size of [16, 32, 64, 128, 256, 512, 1024])
        assert.ok(
            frames.some((frame) => frame.size === size),
            `Missing ICNS ${size}px frame`
        )
    return frames
}

function resizePng(input, output, size) {
    execFileSync("/usr/bin/sips", ["--resampleHeightWidth", String(size), String(size), input, "--out", output], {
        stdio: "pipe"
    })
    normalizePng(output)
    verifyPng(output, size)
}

async function generateAppIcons() {
    if (process.platform !== "darwin")
        throw new Error("Regenerate app icons on macOS (sips decodes the existing JPEG brand master).")
    const originalHash = sha256(fs.readFileSync(source))
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "playtime-app-icons-"))
    try {
        const master = path.join(temp, "master.png")
        execFileSync("/usr/bin/sips", ["--setProperty", "format", "png", source, "--out", master], { stdio: "pipe" })
        normalizePng(master)
        verifyPng(master, 1024)
        const builderRequire = createRequire(
            require.resolve("app-builder-lib", { paths: [require.resolve("electron-builder")] })
        )
        const { runIconsTool } = builderRequire("./toolsets/icons")
        const outputDirectories = Object.fromEntries(
            ["icns", "ico", "set"].map((format) => [format, path.join(temp, format)])
        )
        for (const [outputFormat, outDir] of Object.entries(outputDirectories)) {
            fs.mkdirSync(outDir)
            await runIconsTool({ inputFile: master, outputFormat, outDir })
        }
        const generatedIco = path.join(outputDirectories.ico, "icon.ico")
        const generatedIcns = path.join(outputDirectories.icns, "icon.icns")
        const ico = icoFrames(fs.readFileSync(generatedIco)),
            icns = icnsFrames(fs.readFileSync(generatedIcns))
        const copies = [
            [generatedIcns, "assets/icons/mac/icon.icns"],
            [generatedIco, "assets/icons/win/icon.ico"],
            [generatedIco, "apps/frontend/public/assets/favicon.ico"],
            [generatedIco, "apps/frontend/public/assets/icon.ico"],
            [generatedIco, "apps/frontend/public/favicon.ico"]
        ]
        for (const size of pngSizes) {
            const file = path.join(outputDirectories.set, `${size}x${size}.png`)
            if (!fs.existsSync(file)) resizePng(master, file, size)
            normalizePng(file)
            verifyPng(file, size)
            copies.push([file, `assets/icons/png/${size}x${size}.png`])
        }
        const logo192 = path.join(temp, "logo192.png")
        resizePng(master, logo192, 192)
        copies.push(
            [logo192, "apps/frontend/public/logo192.png"],
            [path.join(outputDirectories.set, "512x512.png"), "apps/frontend/public/logo512.png"]
        )
        for (const [from, relative] of copies) {
            const destination = path.join(root, relative)
            fs.mkdirSync(path.dirname(destination), { recursive: true })
            fs.copyFileSync(from, destination)
        }
        assert.equal(sha256(fs.readFileSync(source)), originalHash, "The canonical brand master must remain unchanged")
        return {
            source: path.relative(root, source),
            sourceSha256: originalHash,
            pngSizes,
            ico,
            icns,
            filesWritten: copies.length
        }
    } finally {
        fs.rmSync(temp, { recursive: true, force: true })
    }
}

if (require.main === module) {
    generateAppIcons()
        .then((result) => console.log(JSON.stringify(result, null, 2)))
        .catch((error) => {
            console.error(error.message)
            process.exitCode = 1
        })
}

module.exports = { generateAppIcons, pngDimensions, icoFrames, icnsFrames }
