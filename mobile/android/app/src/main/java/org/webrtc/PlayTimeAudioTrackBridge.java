package org.webrtc;

public final class PlayTimeAudioTrackBridge {
    private PlayTimeAudioTrackBridge() {}

    public static AudioTrack retain(AudioTrack track) {
        long pointer = track.getNativeMediaStreamTrack();
        JniCommon.nativeAddRef(pointer);
        return new AudioTrack(pointer);
    }
}
