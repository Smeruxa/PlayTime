import { debug } from "../debug";

export function float32ToInt16(buffer: Float32Array) {
    const out = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
        let s = Math.max(-1, Math.min(1, buffer[i]));
        out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }
    return out;
}

export function int16ToFloat32(buffer: Int16Array) {
    const out = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) out[i] = buffer[i] / 32768;
    return out;
}

export async function initAudio(socket: any, roomId: string) {
    const audioContext = new AudioContext()
    const workletPath = debug ? "/recorder-worklet.js" : await (window as any).electronAPI.getWorkletPath()
    await audioContext.audioWorklet.addModule(workletPath)

    const stream = await navigator.mediaDevices.getUserMedia({  
        audio: {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true
        } 
    })
    const source = audioContext.createMediaStreamSource(stream)

    const micGain = audioContext.createGain()
    const micStorage = localStorage.getItem("micState")
    micGain.gain.value = micStorage !== null ? (JSON.parse(micStorage) ? 1 : 0) : 1

    const recorderNode = new AudioWorkletNode(audioContext, "recorder-processor")

    recorderNode.port.onmessage = (event) => {
        const int16 = float32ToInt16(event.data)
        socket.emit("call:room:broadcast", { roomId, voiceData: int16.buffer })
    }

    source.connect(micGain).connect(recorderNode)

    return {
        audioContext,
        mediaStream: stream,
        setMicState: (state: boolean) => {
            const target = state ? 1 : 0;
            micGain.gain.cancelScheduledValues(audioContext.currentTime);
            micGain.gain.linearRampToValueAtTime(target, audioContext.currentTime + 0.05);
            localStorage.setItem("micState", JSON.stringify(state));
        }
    }
}

export function playAudio(audioContext: AudioContext, data: ArrayBuffer) { 
    if (!audioContext) return; 
    const soundValue = Number(localStorage.getItem("valueSound") || 100) / 100; 
    const floatData = int16ToFloat32(new Int16Array(data)); 
    const buffer = audioContext.createBuffer(1, floatData.length, audioContext.sampleRate);
    buffer.copyToChannel(floatData, 0); 
    const gainNode = audioContext.createGain(); 
    gainNode.gain.value = soundValue; 
    const src = audioContext.createBufferSource(); 
    src.buffer = buffer; 
    src.connect(gainNode); 
    gainNode.connect(audioContext.destination); 
    src.start(); 
}