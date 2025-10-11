class RecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = [];
        this._sendThreshold = 8192;
        this._bufferLength = 0;
    }

    process(inputs) {
        const input = inputs[0]?.[0];
        if (input) {
            const chunk = new Float32Array(input);
            this._buffer.push(chunk);
            this._bufferLength += chunk.length;

            if (this._bufferLength >= this._sendThreshold) {
                const out = new Float32Array(this._bufferLength);
                let offset = 0;
                for (const buf of this._buffer) {
                    out.set(buf, offset);
                    offset += buf.length;
                }
                this.port.postMessage(out, [out.buffer]);
                this._buffer = [];
                this._bufferLength = 0;
            }
        }
        return true;
    }
}
registerProcessor("recorder-processor", RecorderProcessor);