const fs = require('node:fs');
const path = require('node:path');

const library = path.join(__dirname, '../node_modules/react-native-webrtc');
const version = JSON.parse(fs.readFileSync(path.join(library, 'package.json'), 'utf8')).version;
if (version !== '155.0.1') {
    throw new Error(
        `PlayTime system-audio adapter requires react-native-webrtc 155.0.1, got ${version}`,
    );
}
const directory = path.join(library, 'android/src/main/java/com/oney/WebRTCModule');
function insertBefore(file, installedCode, anchor, addition) {
    const target = path.join(directory, file);
    const source = fs.readFileSync(target, 'utf8');
    if (source.includes(installedCode)) {
        return;
    }
    if (!source.includes(anchor)) {
        throw new Error(`RN-WebRTC adapter anchor changed: ${file}`);
    }
    fs.writeFileSync(target, source.replace(anchor, `${addition}\n${anchor}`));
}

insertBefore(
    'WebRTCModule.java',
    'public static void playTimeExecute(Runnable action)',
    '    public VideoTrack createVideoTrack(',
    `
    public static void playTimeExecute(Runnable action) {
        ThreadUtils.runOnExecutor(action);
    }

    public android.media.projection.MediaProjection playTimeScreenProjection(String trackId) {
        return getUserMediaImpl.playTimeScreenProjection(trackId);
    }

    public void playTimeRegisterAudioTrack(AudioTrack track) {
        getUserMediaImpl.playTimeRegisterAudioTrack(track);
    }

    public void playTimeDisposeAudioTrack(String trackId) {
        getUserMediaImpl.disposeTrack(trackId);
    }
`,
);

insertBefore(
    'GetUserMediaImpl.java',
    'void playTimeRegisterAudioTrack(AudioTrack track)',
    '    private AudioTrack createAudioTrack(',
    `
    android.media.projection.MediaProjection playTimeScreenProjection(String trackId) {
        TrackPrivate track = tracks.get(trackId);
        if (track == null || track.videoCaptureController == null) return null;
        VideoCapturer capturer = track.videoCaptureController.videoCapturer;
        return capturer instanceof ScreenCapturerAndroid
                ? ((ScreenCapturerAndroid) capturer).getMediaProjection() : null;
    }

    void playTimeRegisterAudioTrack(AudioTrack track) {
        tracks.put(track.id(), new TrackPrivate(track, null, null, null));
    }
`,
);
const mediaFile = path.join(directory, 'GetUserMediaImpl.java');
const mediaSource = fs.readFileSync(mediaFile, 'utf8');
fs.writeFileSync(
    mediaFile,
    mediaSource.replace(
        '                mediaSource.dispose();',
        '                if (mediaSource != null) mediaSource.dispose();',
    ),
);

insertBefore(
    'WebRTCModule.java',
    'public boolean playTimeAutomaticAudioRecordingEnabled()',
    '    public VideoTrack createVideoTrack(',
    `
    private boolean playTimeAutomaticRecording = true;

    public boolean playTimeAutomaticAudioRecordingEnabled() {
        return playTimeAutomaticRecording;
    }

    public void playTimeSetAutomaticAudioRecording(boolean enabled) {
        PeerConnection control = null;
        boolean temporary = false;
        if (mPeerConnectionObservers.size() > 0) {
            control = mPeerConnectionObservers.valueAt(0).getPeerConnection();
        }
        if (control == null) {
            PeerConnectionObserver observer = new PeerConnectionObserver(this, -7202);
            control = mFactory.createPeerConnection(
                    new PeerConnection.RTCConfiguration(java.util.Collections.emptyList()), observer);
            if (control == null) throw new IllegalStateException("Audio control peer unavailable");
            observer.setPeerConnection(control);
            temporary = true;
        }
        try {
            control.setAudioRecording(enabled);
            playTimeAutomaticRecording = enabled;
        } finally {
            if (temporary) control.dispose();
        }
    }

    public void playTimeConfigureScreenCapture(String trackId, int longSide, int fps) {
        getUserMediaImpl.playTimeConfigureScreenCapture(trackId, longSide, fps);
    }
`,
);
const moduleFile = path.join(directory, 'WebRTCModule.java');
const moduleSource = fs.readFileSync(moduleFile, 'utf8');
if (!moduleSource.includes('peerConnection.setAudioRecording(playTimeAutomaticRecording);')) {
    fs.writeFileSync(
        moduleFile,
        moduleSource.replace(
            '                        observer.setPeerConnection(peerConnection);',
            '                        peerConnection.setAudioRecording(playTimeAutomaticRecording);\n' +
                '                        observer.setPeerConnection(peerConnection);',
        ),
    );
}

insertBefore(
    'GetUserMediaImpl.java',
    'void playTimeConfigureScreenCapture(String trackId, int longSide, int fps)',
    '    private AudioTrack createAudioTrack(',
    `
    void playTimeConfigureScreenCapture(String trackId, int longSide, int fps) {
        TrackPrivate track = tracks.get(trackId);
        if (track == null || !(track.videoCaptureController instanceof ScreenCaptureController)) {
            throw new IllegalArgumentException("Active screen track required");
        }
        ScreenCaptureController controller = (ScreenCaptureController) track.videoCaptureController;
        controller.playTimeConfigure(longSide, fps);
        ((VideoSource) track.mediaSource).adaptOutputFormat(controller.getWidth(), controller.getHeight(), fps);
    }
`,
);

const captureFile = path.join(directory, 'ScreenCaptureController.java');
let captureSource = fs.readFileSync(captureFile, 'utf8');
if (!captureSource.includes('private void playTimeUpdateCapture()')) {
    const start = captureSource.indexOf('                DisplayMetrics displayMetrics =');
    const end = captureSource.indexOf('\n            }\n        };', start);
    if (start < 0 || end < 0) {
        throw new Error('RN-WebRTC screen orientation adapter anchor changed');
    }
    captureSource =
        captureSource.slice(0, start) +
        '                ThreadUtils.runOnExecutor(() -> {\n' +
        '                    try { playTimeUpdateCapture(); } catch (Exception ignored) {}\n' +
        '                });' +
        captureSource.slice(end);
    captureSource = captureSource.replace(
        '        this.context = context;',
        '        this.context = context;\n        this.playTimeResolutionScale = resolutionScale;',
    );
    captureSource = captureSource.replace(
        '    @Override\n    public String getDeviceId()',
        `    private int playTimeLongSide = 0;
    private int playTimeFps = DEFAULT_FPS;
    private float playTimeResolutionScale = 1f;

    void playTimeConfigure(int longSide, int fps) {
        if (longSide < 240 || longSide > 3840 || fps < 1 || fps > 60) {
            throw new IllegalArgumentException("Invalid screen quality");
        }
        playTimeLongSide = longSide;
        playTimeFps = fps;
        playTimeUpdateCapture();
    }

    private void playTimeUpdateCapture() {
        DisplayMetrics metrics = DisplayUtils.getDisplayMetrics((Activity) context);
        float scale = playTimeLongSide > 0
                ? Math.min(1f, (float) playTimeLongSide / Math.max(metrics.widthPixels, metrics.heightPixels))
                : playTimeResolutionScale;
        int width = Math.max(2, ((int) (metrics.widthPixels * scale) / 2) * 2);
        int height = Math.max(2, ((int) (metrics.heightPixels * scale) / 2) * 2);
        if (videoCapturer == null || (width == targetWidth && height == targetHeight && playTimeFps == targetFps)) return;
        videoCapturer.changeCaptureFormat(width, height, playTimeFps);
        actualWidth = targetWidth = width;
        actualHeight = targetHeight = height;
        actualFps = targetFps = playTimeFps;
    }

    @Override
    public String getDeviceId()`,
    );
    fs.writeFileSync(captureFile, captureSource);
}

insertBefore(
    'WebRTCModule.java',
    'void playTimeDetachLocalTrack(MediaStreamTrack track)',
    '    public VideoTrack createVideoTrack(',
    `
    void playTimeDetachLocalTrack(MediaStreamTrack track) {
        for (MediaStream stream : localStreams.values()) {
            if (track instanceof AudioTrack && stream.audioTracks.contains(track)) {
                stream.removeTrack((AudioTrack) track);
            } else if (track instanceof VideoTrack && stream.videoTracks.contains(track)) {
                stream.removeTrack((VideoTrack) track);
            }
        }
    }
`,
);
const disposalSource = fs.readFileSync(mediaFile, 'utf8');
if (!disposalSource.includes('webRTCModule.playTimeDetachLocalTrack(track.track);')) {
    const disposalAnchor = '        if (track != null) {\n            track.dispose();';
    if (!disposalSource.includes(disposalAnchor)) {
        throw new Error('RN-WebRTC track-disposal adapter anchor changed');
    }
    fs.writeFileSync(
        mediaFile,
        disposalSource.replace(
            disposalAnchor,
            '        if (track != null) {\n' +
                '            webRTCModule.playTimeDetachLocalTrack(track.track);\n' +
                '            track.dispose();',
        ),
    );
}

const senderDetachSource = fs.readFileSync(moduleFile, 'utf8');
if (
    !senderDetachSource.includes(
        'if (current != null && current.id().equals(trackId)) sender.setTrack(null, false);',
    )
) {
    const anchor = '    void playTimeDetachLocalTrack(MediaStreamTrack track) {';
    if (!senderDetachSource.includes(anchor)) {
        throw new Error('RN-WebRTC sender-disposal adapter anchor changed');
    }
    fs.writeFileSync(
        moduleFile,
        senderDetachSource.replace(
            anchor,
            `${anchor}
        String trackId = track.id();
        for (int index = 0; index < mPeerConnectionObservers.size(); index++) {
            PeerConnection connection = mPeerConnectionObservers.valueAt(index).getPeerConnection();
            if (connection == null) continue;
            for (RtpSender sender : connection.getSenders()) {
                MediaStreamTrack current = sender.track();
                if (current != null && current.id().equals(trackId)) sender.setTrack(null, false);
            }
        }`,
        ),
    );
}

const observerFile = path.join(directory, 'PeerConnectionObserver.java');
const observerSource = fs.readFileSync(observerFile, 'utf8');
if (!observerSource.includes('if (sender.track() != null) sender.setTrack(null, false);')) {
    const anchor = '        peerConnection.close();';
    if (!observerSource.includes(anchor)) {
        throw new Error('RN-WebRTC peer-close adapter anchor changed');
    }
    fs.writeFileSync(
        observerFile,
        observerSource.replace(
            anchor,
            `        for (RtpSender sender : peerConnection.getSenders()) {
            if (sender.track() != null) sender.setTrack(null, false);
        }
${anchor}`,
        ),
    );
}
