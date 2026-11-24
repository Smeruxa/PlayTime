import { act, render } from "@testing-library/react"
import LocalScreenVideo from "./LocalScreenVideo"

class TestStream extends EventTarget {
    constructor(private tracks: MediaStreamTrack[] = []) {
        super()
    }
    getTracks() {
        return [...this.tracks]
    }
    getAudioTracks() {
        return this.tracks.filter((track) => track.kind === "audio")
    }
    getVideoTracks() {
        return this.tracks.filter((track) => track.kind === "video")
    }
    getTrackById(id: string) {
        return this.tracks.find((track) => track.id === id)
    }
    addTrack(track: MediaStreamTrack) {
        this.tracks.push(track)
        this.dispatchEvent(new Event("addtrack"))
    }
    removeTrack(track: MediaStreamTrack) {
        this.tracks = this.tracks.filter((candidate) => candidate !== track)
        this.dispatchEvent(new Event("removetrack"))
    }
}

const track = (id: string, kind: string) =>
    ({ id, kind, readyState: "live", enabled: true, stop: jest.fn() }) as unknown as MediaStreamTrack
const stream = (...tracks: MediaStreamTrack[]) => new TestStream(tracks) as unknown as MediaStream
let previousStream: typeof MediaStream

beforeEach(() => {
    previousStream = global.MediaStream
    global.MediaStream = TestStream as unknown as typeof MediaStream
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue()
    jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
})
afterEach(() => {
    global.MediaStream = previousStream
    jest.restoreAllMocks()
})

test("native video controls cannot bypass the single demo audio output; zero detaches playback", () => {
    const videoTrack = track("picture", "video"),
        audioTrack = track("demo", "audio")
    const source = stream(videoTrack, audioTrack)
    const { container, rerender, unmount } = render(<LocalScreenVideo stream={source} className="screen" />)
    const video = container.querySelector("video")!,
        audio = container.querySelector("audio")!
    expect((video.srcObject as MediaStream).getAudioTracks()).toHaveLength(0)
    expect(video.controls).toBe(false)
    expect((audio.srcObject as MediaStream).getAudioTracks()).toEqual([audioTrack])
    for (const volume of [1, 50, 100, 0]) {
        rerender(<LocalScreenVideo stream={source} className="screen" volume={volume} />)
        expect(audio.volume).toBe(volume / 100)
        expect(audio.muted).toBe(volume === 0)
        expect(Boolean(audio.srcObject)).toBe(volume > 0)
    }
    video.muted = false
    expect((video.srcObject as MediaStream).getAudioTracks()).toHaveLength(0)
    rerender(<LocalScreenVideo stream={source} className="screen" volume={50} />)
    expect(audio.muted).toBe(false)
    expect(audio.srcObject).not.toBeNull()
    unmount()
    expect(audio.srcObject).toBeNull()
    expect(video.srcObject).toBeNull()
    expect(audioTrack.enabled).toBe(true)
    expect(audioTrack.stop).not.toHaveBeenCalled()
})

test("muted and zero-volume demos stay silent when audio arrives late or a source reconnects", () => {
    const source = stream(track("picture", "video"))
    const { container, rerender } = render(<LocalScreenVideo stream={source} className="screen" volume={0} />)
    const audio = container.querySelector("audio")!
    act(() => source.addTrack(track("late", "audio")))
    expect(audio.srcObject).toBeNull()
    const replacementAudio = track("replacement", "audio")
    const replacement = stream(track("replacement-video", "video"), replacementAudio)
    rerender(<LocalScreenVideo stream={replacement} className="screen" volume={50} muted />)
    expect(audio.srcObject).toBeNull()
    rerender(<LocalScreenVideo stream={replacement} className="screen" volume={50} />)
    expect((audio.srcObject as MediaStream).getTracks()).toEqual([replacementAudio])
    act(() => replacement.removeTrack(replacementAudio))
    expect(audio.srcObject).toBeNull()
})
