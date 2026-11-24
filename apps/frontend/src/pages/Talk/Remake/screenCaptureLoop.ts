export type CaptureDrawSource = {
    width: number
    height: number
    draw: (ctx: CanvasRenderingContext2D, drawW: number, drawH: number) => void
}

export type StartScreenCaptureLoopArgs = {
    stream: MediaStream
    minIntervalMs: number
    onCapture: (source: CaptureDrawSource) => void
}

function startProcessorLoop(track: MediaStreamTrack, args: StartScreenCaptureLoopArgs): (() => void) | null {
    if (typeof MediaStreamTrackProcessor === "undefined") return null

    let running = true
    let reader: ReadableStreamDefaultReader<VideoFrame> | null = null

    try {
        const processor = new MediaStreamTrackProcessor({ track })
        reader = processor.readable.getReader()
    } catch {
        return null
    }

    let lastEmit = 0

    const readLoop = async () => {
        while (running && reader) {
            let frame: VideoFrame | undefined
            try {
                const result = await reader.read()
                if (result.done) break
                frame = result.value
                if (!frame) continue

                const now = performance.now()
                if (now - lastEmit < args.minIntervalMs) continue
                lastEmit = now

                const w = frame.displayWidth || frame.codedWidth || 0
                const h = frame.displayHeight || frame.codedHeight || 0
                if (!w || !h) continue

                args.onCapture({
                    width: w,
                    height: h,
                    draw: (ctx, drawW, drawH) => {
                        ctx.drawImage(frame!, 0, 0, drawW, drawH)
                    }
                })
            } catch {
                break
            } finally {
                frame?.close()
            }
        }
    }

    void readLoop()

    return () => {
        running = false
        void reader?.cancel().catch(() => {})
        reader = null
    }
}

function startVideoElementLoop(stream: MediaStream, args: StartScreenCaptureLoopArgs): () => void {
    let running = true
    const video = document.createElement("video")
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.setAttribute("aria-hidden", "true")
    Object.assign(video.style, {
        position: "fixed",
        left: "-9999px",
        top: "0",
        width: "640px",
        height: "360px",
        opacity: "0",
        pointerEvents: "none",
        zIndex: "-1"
    })
    document.body.appendChild(video)
    void video.play().catch(() => {})

    let lastEmit = 0
    let vfcId: number | null = null
    let rafId: number | null = null

    const tick = () => {
        if (!running || !streamRefAlive(stream)) return
        const now = performance.now()
        if (now - lastEmit >= args.minIntervalMs && video.readyState >= 2) {
            lastEmit = now
            const w = video.videoWidth || stream.getVideoTracks()[0]?.getSettings().width || 1920
            const h = video.videoHeight || stream.getVideoTracks()[0]?.getSettings().height || 1080
            if (w && h) {
                args.onCapture({
                    width: w,
                    height: h,
                    draw: (ctx, drawW, drawH) => {
                        ctx.drawImage(video, 0, 0, drawW, drawH)
                    }
                })
            }
        }
    }

    const onVideoFrame: VideoFrameRequestCallback = () => {
        if (!running) return
        tick()
        if (running && typeof video.requestVideoFrameCallback === "function") {
            vfcId = video.requestVideoFrameCallback(onVideoFrame)
        }
    }

    const onRaf = () => {
        if (!running) return
        tick()
        if (running) rafId = requestAnimationFrame(onRaf)
    }

    if (typeof video.requestVideoFrameCallback === "function") {
        vfcId = video.requestVideoFrameCallback(onVideoFrame)
    } else {
        rafId = requestAnimationFrame(onRaf)
    }

    return () => {
        running = false
        if (vfcId != null && typeof video.cancelVideoFrameCallback === "function") {
            try {
                video.cancelVideoFrameCallback(vfcId)
            } catch {
            }
        }
        if (rafId != null) cancelAnimationFrame(rafId)
        video.srcObject = null
        try {
            video.pause()
        } catch {
        }
        if (video.parentNode) video.parentNode.removeChild(video)
    }
}

function streamRefAlive(stream: MediaStream) {
    const t = stream.getVideoTracks()[0]
    return t != null && t.readyState === "live"
}

export function startScreenCaptureLoop(args: StartScreenCaptureLoopArgs): () => void {
    const track = args.stream.getVideoTracks()[0]
    if (!track || track.readyState !== "live") return () => {}

    const processorStop = startProcessorLoop(track, args)
    if (processorStop) return processorStop

    return startVideoElementLoop(args.stream, args)
}
