import Rnnoise from "@jitsi/rnnoise-wasm"

const rnnoise = await Rnnoise()
process.on("message", data => {
    const input = new Int16Array(data)
    const frameSize = 480
    const output = new Int16Array(input.length)
    for (let i = 0; i < input.length; i += frameSize) {
        const chunk = input.subarray(i, i + frameSize)
        const denoised = rnnoise.processFrame(chunk)
        output.set(denoised, i)
    }
    process.send(output.buffer, [output.buffer])
})