import type { MediaStream } from 'react-native-webrtc';

export function detachScreenAudio(stream: MediaStream | null) {
    if (!stream) {
        return;
    }
    for (const track of stream.getAudioTracks()) {
        stream.removeTrack(track);
        track.stop();
    }
}
