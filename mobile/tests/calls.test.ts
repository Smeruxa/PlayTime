import { AppState, DeviceEventEmitter, NativeModules, PermissionsAndroid } from 'react-native';
import { mediaDevices } from 'react-native-webrtc';
import type { Socket } from 'socket.io-client';
import { CallController } from '../src/features/calls/CallController';
import { NativeVoiceMesh } from '../src/features/calls/NativeVoiceMesh';
import { requestCallMicrophone } from '../src/features/calls/nativeAudio';
import type { DirectCallState } from '../src/features/calls/types';

jest.mock('react-native', () => ({
    AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    DeviceEventEmitter: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
    Dimensions: { get: () => ({ width: 360, height: 800, scale: 3 }) },
    Linking: { openSettings: jest.fn() },
    NativeModules: {
        PlayTimeNative: {
            startCallAudio: jest.fn().mockResolvedValue(true),
            stopCallAudio: jest.fn().mockResolvedValue(true),
            setSpeakerphone: jest.fn().mockResolvedValue(true),
            startCallRinging: jest.fn().mockResolvedValue(true),
            stopCallRinging: jest.fn().mockResolvedValue(true),
            systemAudioSupported: true,
            startSystemAudioShare: jest.fn().mockResolvedValue({
                screenInfo: { id: 'system-audio', kind: 'audio' },
                microphoneInfo: { id: 'relay-microphone', kind: 'audio' },
            }),
            stopSystemAudioShare: jest.fn().mockResolvedValue(true),
            setAutomaticAudioRecording: jest.fn().mockResolvedValue(true),
            configureScreenCapture: jest.fn().mockResolvedValue(true),
            getAudioRoutes: jest
                .fn()
                .mockResolvedValue([{ id: 'speaker', name: 'Динамик', type: 'speaker' }]),
        },
    },
    Platform: { OS: 'android', Version: 35 },
    PermissionsAndroid: {
        PERMISSIONS: { RECORD_AUDIO: 'microphone', BLUETOOTH_CONNECT: 'bluetooth' },
        RESULTS: { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' },
        check: jest.fn().mockResolvedValue(true),
        request: jest.fn().mockResolvedValue('granted'),
    },
}));
jest.mock('react-native-webrtc', () => ({
    mediaDevices: { getUserMedia: jest.fn(), getDisplayMedia: jest.fn() },
    MediaStream: jest.fn(),
    MediaStreamTrack: jest.fn().mockImplementation((info) => ({
        ...info,
        enabled: true,
        stop: jest.fn(),
    })),
}));
jest.mock('../src/features/calls/NativeVoiceMesh', () => ({
    NativeVoiceMesh: jest.fn().mockImplementation(() => ({
        setMuted: jest.fn(),
        applyVolumes: jest.fn(),
        signal: jest.fn().mockResolvedValue(undefined),
        offer: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn(),
        reconnect: jest.fn(),
        ping: jest.fn().mockResolvedValue(20),
        setScreen: jest.fn().mockResolvedValue(undefined),
        replaceMicrophoneTrack: jest.fn().mockResolvedValue(undefined),
        updateScreenLimits: jest.fn().mockResolvedValue(undefined),
        replacePeer: jest.fn().mockReturnValue(true),
    })),
}));
jest.mock('../src/features/calls/preferences', () => ({
    loadCallPreferences: jest.fn().mockResolvedValue({}),
    saveCallPreferences: jest.fn().mockResolvedValue(undefined),
    clampVolume: (value: number) => Math.max(0, Math.min(200, value)),
}));

type Ack = (error: Error | null, response?: unknown) => void;
class FakeSocket {
    connected = true;
    listeners = new Map<string, Set<(value: unknown) => void>>();
    requests: string[] = [];
    sent: Array<{ event: string; payload: unknown }> = [];
    responders = new Map<string, (ack: Ack) => void>();
    current: DirectCallState | null = null;
    on(event: string, callback: (value: unknown) => void) {
        const group = this.listeners.get(event) ?? new Set();
        group.add(callback);
        this.listeners.set(event, group);
    }
    off(event: string, callback: (value: unknown) => void) {
        this.listeners.get(event)?.delete(callback);
    }
    timeout() {
        return this;
    }
    emit(event: string, ...args: unknown[]) {
        this.requests.push(event);
        this.sent.push({ event, payload: typeof args[0] === 'function' ? undefined : args[0] });
        if (event === 'webrtc:config:request') {
            this.receive('webrtc:config', { iceServers: [] });
        }
        const callback = args[args.length - 1];
        if (typeof callback !== 'function') {
            return;
        }
        const ack = callback as Ack;
        const respond = this.responders.get(event);
        if (respond) {
            respond(ack);
        } else if (event === 'call:current') {
            ack(null, { state: this.current });
        } else {
            ack(null, { success: true });
        }
    }
    receive(event: string, value: unknown) {
        this.listeners.get(event)?.forEach((listener) => listener(value));
    }
}

const ringing: DirectCallState = {
    roomId: '1:2:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    status: 'request_receiver',
    revision: 1,
    caller: { id: 1, username: 'Mika' },
    receiver: { id: 2, username: 'Nova' },
    expiresAt: 60000,
};
const connected: DirectCallState = { ...ringing, status: 'in_call', revision: 2 };
const controllers: CallController[] = [];
const create = (socket: FakeSocket, userId = 1) => {
    const controller = new CallController({
        socket: socket as unknown as Socket,
        userId,
        username: userId === 1 ? 'Mika' : 'Nova',
    });
    controllers.push(controller);
    return controller;
};
const flush = async () => {
    for (let i = 0; i < 16; i++) {
        await Promise.resolve();
    }
};

beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
    jest.clearAllMocks();
    jest.mocked(PermissionsAndroid.check).mockResolvedValue(true);
    jest.mocked(PermissionsAndroid.request).mockResolvedValue('granted');
    AppState.currentState = 'active';
    jest.mocked(mediaDevices.getUserMedia).mockResolvedValue({
        getTracks: () => [],
        release: jest.fn(),
    } as never);
});
afterEach(() => {
    controllers.splice(0).forEach((controller) => controller.dispose());
    jest.useRealTimers();
});

function captureStream() {
    const video = { id: 'screen-video', addEventListener: jest.fn(), stop: jest.fn() };
    const audio: Array<{ id: string; stop: () => void }> = [];
    return {
        getTracks: () => [video, ...audio],
        getVideoTracks: () => [video],
        getAudioTracks: () => audio,
        addTrack: (track: { id: string; stop: () => void }) => audio.push(track),
        removeTrack: (track: { id: string }) =>
            audio.splice(
                audio.findIndex((item) => item.id === track.id),
                1,
            ),
        release: jest.fn(),
    };
}

test('screen capture defaults to Free plan resolution and frame rate', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    socket.receive('call:state', connected);
    await flush();
    const stream = captureStream();
    jest.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(stream as never);
    await controller.startScreenShare();
    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledWith({
        android: { resolutionScale: 854 / 2400 },
    });
    expect(NativeModules.PlayTimeNative.configureScreenCapture).toHaveBeenCalledWith(
        'screen-video',
        854,
        10,
    );
    const mesh = jest.mocked(NativeVoiceMesh).mock.results.at(-1)!.value;
    expect(mesh.setScreen).toHaveBeenCalledWith(stream, { targetLongSide: 854, maxFps: 10 });
});

test('system audio switches off automatic microphone delivery before forwarding and restores it after detach', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    socket.receive('call:state', connected);
    await flush();
    const stream = captureStream();
    jest.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(stream as never);
    await controller.startScreenShare(true);
    const mesh = jest.mocked(NativeVoiceMesh).mock.results.at(-1)!.value;
    const native = NativeModules.PlayTimeNative;
    expect(controller.snapshot.localSystemAudio).toBe(true);
    expect(native.setAutomaticAudioRecording).toHaveBeenCalledWith(false);
    expect(native.setAutomaticAudioRecording.mock.invocationCallOrder[0]).toBeLessThan(
        native.startSystemAudioShare.mock.invocationCallOrder[0],
    );
    expect(mesh.replaceMicrophoneTrack).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'relay-microphone' }),
    );
    native.stopSystemAudioShare.mockImplementationOnce(async () => {
        expect(stream.getAudioTracks()).toEqual([]);
        return true;
    });
    await controller.stopScreenShare();
    expect(mesh.replaceMicrophoneTrack).toHaveBeenLastCalledWith(null);
    expect(native.setAutomaticAudioRecording).toHaveBeenLastCalledWith(true);
    expect(native.stopSystemAudioShare.mock.invocationCallOrder.at(-1)).toBeLessThan(
        native.setAutomaticAudioRecording.mock.invocationCallOrder.at(-1),
    );
    expect(controller.snapshot.localScreen).toBeNull();
});

test('failed native system audio restores the microphone and keeps screen video usable', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    socket.receive('call:state', connected);
    await flush();
    const stream = captureStream();
    jest.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(stream as never);
    NativeModules.PlayTimeNative.startSystemAudioShare.mockRejectedValueOnce(
        new Error('Capture unavailable'),
    );
    await controller.startScreenShare(true);
    expect(controller.snapshot.localScreen).toBe(stream);
    expect(controller.snapshot.localSystemAudio).toBe(false);
    expect(controller.snapshot.error).toContain('без звука приложений');
    expect(NativeModules.PlayTimeNative.setAutomaticAudioRecording).toHaveBeenLastCalledWith(true);
});

test('permission denial prevents reserving a call and permanent denial offers settings', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    jest.mocked(PermissionsAndroid.check).mockResolvedValue(false);
    jest.mocked(PermissionsAndroid.request).mockResolvedValue('never_ask_again');
    await expect(controller.start('Nova')).rejects.toThrow('настройках Android');
    expect(PermissionsAndroid.request).toHaveBeenCalledWith(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    expect(socket.requests).not.toContain('call:start');
    expect(controller.snapshot.permissionBlocked).toBe(true);
    expect(controller.snapshot.busy).toBe(false);
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('Bluetooth denial preserves basic audio routes and exposes settings for permanent denial', async () => {
    const controller = create(new FakeSocket());
    await flush();
    jest.mocked(PermissionsAndroid.check).mockResolvedValue(false);
    jest.mocked(PermissionsAndroid.request).mockResolvedValue('never_ask_again');
    await expect(controller.getAudioRoutes()).resolves.toEqual([
        { id: 'speaker', name: 'Динамик', type: 'speaker' },
    ]);
    expect(PermissionsAndroid.request).toHaveBeenCalledWith(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    );
    expect(controller.snapshot.bluetoothPermission).toBe('blocked');
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('granted microphone permission is reused without another permission request', async () => {
    await requestCallMicrophone();
    expect(PermissionsAndroid.request).not.toHaveBeenCalled();
});

test('incoming ringing never captures the microphone before acceptance', async () => {
    const socket = new FakeSocket();
    const controller = create(socket, 2);
    await flush();
    socket.receive('call:state', ringing);
    expect(controller.snapshot.incoming?.from).toBe('Mika');
    expect(controller.snapshot.call).toBeNull();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(NativeModules.PlayTimeNative.startCallRinging).toHaveBeenCalledWith(true);
    await controller.reject();
    expect(controller.snapshot.incoming).toBeNull();
    expect(socket.requests).toContain('call:confirm');
    expect(NativeModules.PlayTimeNative.stopCallRinging).toHaveBeenCalled();
});

test('notification end action stops the call and releases the microphone', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    socket.receive('call:state', connected);
    await flush();
    const end = jest
        .mocked(DeviceEventEmitter.addListener)
        .mock.calls.find(([event]) => event === 'PlayTimeCallEndRequested')?.[1];
    expect(end).toBeDefined();
    end?.();
    expect(controller.snapshot.call).toBeNull();
    expect(socket.requests).toContain('call:end');
    expect(NativeModules.PlayTimeNative.stopCallAudio).toHaveBeenCalled();
});

test('backgrounding an incoming call silences ringtone and logout cannot restart it', async () => {
    const socket = new FakeSocket();
    const controller = create(socket, 2);
    await flush();
    socket.receive('call:state', ringing);
    const changeState = jest.mocked(AppState.addEventListener).mock.calls[0][1];
    changeState('background');
    expect(NativeModules.PlayTimeNative.stopCallRinging).toHaveBeenCalledTimes(1);
    changeState('active');
    expect(NativeModules.PlayTimeNative.startCallRinging).toHaveBeenCalledTimes(2);
    controller.dispose();
    expect(NativeModules.PlayTimeNative.stopCallRinging).toHaveBeenCalledTimes(2);
});

test('a stale recovery response cannot clear a newly arrived incoming call', async () => {
    const socket = new FakeSocket();
    let finish: Ack | undefined;
    socket.responders.set('call:current', (ack) => {
        finish = ack;
    });
    const controller = create(socket, 2);
    socket.receive('call:state', ringing);
    finish?.(null, { state: null });
    await flush();
    expect(controller.snapshot.incoming?.roomId).toBe(ringing.roomId);
});

test('late confirmation after ending cannot resurrect the call', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    socket.receive('call:state', ringing);
    controller.end();
    socket.receive('call:confirmed', { roomId: ringing.roomId });
    socket.receive('call:state', connected);
    await flush();
    expect(controller.snapshot.call).toBeNull();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('background recovery waits for an explicit foreground audio connection', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    AppState.currentState = 'background';
    socket.receive('call:state', connected);
    expect(controller.snapshot.needsResume).toBe(true);
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    AppState.currentState = 'active';
    await controller.resumeMedia();
    expect(controller.snapshot.needsResume).toBe(false);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
});

test('server recovery without permission shows a connect action without an unsolicited dialog', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    jest.mocked(PermissionsAndroid.check).mockResolvedValue(false);
    socket.receive('call:state', connected);
    await flush();
    expect(controller.snapshot.needsResume).toBe(true);
    expect(PermissionsAndroid.request).not.toHaveBeenCalled();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('simultaneous confirmed events share one microphone and release it on end', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    socket.receive('call:state', connected);
    socket.receive('call:confirmed', { roomId: connected.roomId });
    socket.receive('call:state', connected);
    await flush();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(NativeVoiceMesh).toHaveBeenCalledTimes(1);
    controller.end();
    expect(controller.snapshot.call).toBeNull();
    expect(NativeModules.PlayTimeNative.stopCallAudio).toHaveBeenCalled();
});

test('cancelled call releases a microphone that resolves after cancellation', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    const stop = jest.fn();
    const release = jest.fn();
    let resolveStream: ((stream: never) => void) | undefined;
    jest.mocked(mediaDevices.getUserMedia).mockImplementation(
        () =>
            new Promise((resolve) => {
                resolveStream = resolve;
            }),
    );
    socket.receive('call:state', connected);
    await flush();
    controller.end();
    resolveStream?.({ getTracks: () => [{ stop }], release } as never);
    await flush();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(NativeVoiceMesh).not.toHaveBeenCalled();
});

test('ring timeout clears the outgoing call and notifies the server', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    socket.receive('call:state', ringing);
    jest.advanceTimersByTime(60001);
    expect(controller.snapshot.call).toBeNull();
    expect(controller.snapshot.error).toBe('Собеседник не ответил');
    expect(socket.requests).toContain('call:end');
});

const modernConnected: DirectCallState = {
    ...connected,
    caller: { ...connected.caller, ownershipRevision: 1 },
    receiver: { ...connected.receiver, ownershipRevision: 3 },
    media: { active: true, canClaim: true, ownershipRevision: 1 },
};

test('an ongoing call on another endpoint stays passive without microphone or automatic resume', async () => {
    const socket = new FakeSocket();
    socket.current = {
        ...modernConnected,
        media: { active: false, canClaim: true, ownershipRevision: 1 },
    };
    const controller = create(socket);
    await flush();
    expect(controller.snapshot.call).toBeNull();
    expect(controller.snapshot.ongoingElsewhere?.roomId).toBe(connected.roomId);
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(NativeModules.PlayTimeNative.startCallAudio).not.toHaveBeenCalled();
    expect(NativeVoiceMesh).not.toHaveBeenCalled();
    expect(socket.requests).not.toContain('call:resume');
    await controller.recover();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('explicit claim uses the observed ownership epoch and activates only the acknowledged owner', async () => {
    const socket = new FakeSocket();
    socket.current = {
        ...modernConnected,
        media: { active: false, canClaim: true, ownershipRevision: 1 },
    };
    const controller = create(socket);
    await flush();
    socket.responders.set('call:claim', (ack) =>
        ack(null, {
            state: {
                ...modernConnected,
                caller: { ...modernConnected.caller, ownershipRevision: 2 },
                media: { active: true, canClaim: true, ownershipRevision: 2 },
            },
        }),
    );
    await controller.claim();
    await flush();
    expect(socket.sent.find((row) => row.event === 'call:claim')?.payload).toEqual({
        roomId: connected.roomId,
        expectedOwnershipRevision: 1,
    });
    expect(controller.snapshot.ongoingElsewhere).toBeNull();
    expect(controller.snapshot.call?.ownershipRevision).toBe(2);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
});

test('a stale claim refreshes the passive state and requires another click', async () => {
    const socket = new FakeSocket();
    socket.current = {
        ...modernConnected,
        media: { active: false, canClaim: true, ownershipRevision: 1 },
    };
    const controller = create(socket);
    await flush();
    socket.current = {
        ...modernConnected,
        media: { active: false, canClaim: true, ownershipRevision: 2 },
    };
    socket.responders.set('call:claim', (ack) =>
        ack(null, { err: 'Звонок уже перенесён. Попробуйте ещё раз.' }),
    );
    await expect(controller.claim()).rejects.toThrow('Звонок уже перенесён');
    await flush();
    expect(socket.requests.filter((event) => event === 'call:claim')).toHaveLength(1);
    expect(controller.snapshot.ongoingElsewhere?.media?.ownershipRevision).toBe(2);
    expect(controller.snapshot.call).toBeNull();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('ownership loss stops local media and capture without ending the global personal call', async () => {
    const socket = new FakeSocket();
    socket.current = modernConnected;
    const controller = create(socket);
    await flush();
    const capture = captureStream();
    jest.mocked(mediaDevices.getDisplayMedia).mockResolvedValueOnce(capture as never);
    await controller.startScreenShare();
    const mesh = jest.mocked(NativeVoiceMesh).mock.results[0].value;
    socket.receive('call:ownershipLost', { roomId: connected.roomId, ownershipRevision: 2 });
    await flush();
    expect(mesh.destroy).toHaveBeenCalledTimes(1);
    expect(capture.getVideoTracks()[0].stop).toHaveBeenCalled();
    expect(NativeModules.PlayTimeNative.stopCallAudio).toHaveBeenCalled();
    expect(controller.snapshot.call).toBeNull();
    expect(controller.snapshot.ongoingElsewhere?.media?.active).toBe(false);
    expect(socket.requests).not.toContain('call:end');
    socket.receive('call:state', modernConnected);
    await flush();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
});

test('remote endpoint replacement resets just that peer and rejects old epoch signals', async () => {
    const socket = new FakeSocket();
    socket.current = modernConnected;
    const controller = create(socket);
    await flush();
    const mesh = jest.mocked(NativeVoiceMesh).mock.results[0].value;
    mesh.offer.mockClear();
    socket.receive('webrtc:peer:replaced', {
        context: 'direct',
        roomId: connected.roomId,
        userId: 2,
        ownershipRevision: 4,
    });
    await flush();
    expect(mesh.replacePeer).toHaveBeenCalledWith(2, 4);
    expect(mesh.offer).toHaveBeenCalledWith(2, 'Nova');
    expect(mesh.destroy).not.toHaveBeenCalled();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    const signal = {
        roomId: connected.roomId,
        context: 'direct',
        fromUserId: 2,
        type: 'offer',
        targetOwnershipRevision: 1,
        payload: { type: 'offer', sdp: 'm=audio' },
    };
    socket.receive('webrtc:signal', { ...signal, fromOwnershipRevision: 3 });
    expect(mesh.signal).not.toHaveBeenCalled();
    socket.receive('webrtc:signal', { ...signal, fromOwnershipRevision: 4 });
    expect(mesh.signal).toHaveBeenCalledTimes(1);
    socket.receive('webrtc:peer:replaced', {
        context: 'direct',
        roomId: connected.roomId,
        userId: 2,
        ownershipRevision: 3,
    });
    expect(mesh.replacePeer).toHaveBeenCalledTimes(1);
});

test('owned personal lifecycle messages carry the captured local epoch', async () => {
    const socket = new FakeSocket();
    socket.current = modernConnected;
    const controller = create(socket);
    await flush();
    expect(socket.sent.find((row) => row.event === 'call:resume')?.payload).toEqual({
        roomId: connected.roomId,
        ownershipRevision: 1,
    });
    jest.advanceTimersByTime(20000);
    await flush();
    expect(socket.sent.find((row) => row.event === 'call:heartbeat')?.payload).toEqual({
        roomId: connected.roomId,
        ownershipRevision: 1,
    });
    controller.end();
    expect(socket.sent.find((row) => row.event === 'call:end')?.payload).toEqual({
        roomId: connected.roomId,
        ownershipRevision: 1,
    });
});

test('malformed modern ownership metadata cannot start microphone capture', async () => {
    const socket = new FakeSocket();
    const controller = create(socket);
    await flush();
    socket.receive('call:state', {
        ...modernConnected,
        media: { active: 'false', canClaim: true, ownershipRevision: 1 },
    });
    socket.receive('call:state', {
        ...modernConnected,
        media: { active: true, canClaim: true, ownershipRevision: -1 },
    });
    socket.receive('call:state', { ...modernConnected, media: null });
    socket.receive('call:state', {
        ...modernConnected,
        media: { active: true, canClaim: true, ownershipRevision: 0 },
    });
    await flush();
    expect(controller.snapshot.call).toBeNull();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('an unbound incoming ring remains answerable before it owns media', async () => {
    const socket = new FakeSocket();
    socket.current = {
        ...ringing,
        caller: modernConnected.caller,
        receiver: modernConnected.receiver,
        media: { active: false, canClaim: true, ownershipRevision: 0 },
    };
    const controller = create(socket, 2);
    await flush();
    expect(controller.snapshot.incoming?.roomId).toBe(ringing.roomId);
    expect(controller.snapshot.ongoingElsewhere).toBeNull();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    socket.responders.set('call:confirm', (ack) =>
        ack(null, {
            state: {
                ...modernConnected,
                media: { active: true, canClaim: true, ownershipRevision: 3 },
            },
        }),
    );
    await controller.accept();
    await flush();
    expect(controller.snapshot.call?.incoming).toBe(true);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
});

test('the same endpoint reconnect resumes its owned lease without acquiring a second microphone', async () => {
    const socket = new FakeSocket();
    socket.current = modernConnected;
    const controller = create(socket);
    await flush();
    socket.receive('disconnect', undefined);
    socket.receive('connect', undefined);
    await flush();
    expect(controller.snapshot.call?.ownershipRevision).toBe(1);
    expect(controller.snapshot.ongoingElsewhere).toBeNull();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(socket.requests.filter((event) => event === 'call:resume')).toHaveLength(2);
});

test('a non-owner caller opening during an outgoing ring stays passive', async () => {
    const socket = new FakeSocket();
    socket.current = {
        ...ringing,
        caller: modernConnected.caller,
        receiver: modernConnected.receiver,
        media: { active: false, canClaim: false, ownershipRevision: 1 },
    };
    const controller = create(socket);
    await flush();
    expect(controller.snapshot.call).toBeNull();
    expect(controller.snapshot.ongoingElsewhere?.status).toBe('request_receiver');
    expect(NativeModules.PlayTimeNative.startCallRinging).not.toHaveBeenCalled();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('old confirmation and no-answer epochs cannot activate or cancel a newer owned ring', async () => {
    const socket = new FakeSocket();
    socket.current = {
        ...ringing,
        caller: { ...ringing.caller, ownershipRevision: 3 },
        receiver: { ...ringing.receiver, ownershipRevision: 1 },
        media: { active: true, canClaim: true, ownershipRevision: 3 },
    };
    const controller = create(socket);
    await flush();
    socket.receive('call:confirmed', { roomId: ringing.roomId, ownershipRevision: 1 });
    socket.receive('call:confirmed', { roomId: ringing.roomId });
    socket.receive('call:noAnswer', { roomId: ringing.roomId, ownershipRevision: 1 });
    await flush();
    expect(controller.snapshot.call?.phase).toBe('ringing');
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    socket.receive('call:confirmed', { roomId: ringing.roomId, ownershipRevision: 3 });
    await flush();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
});

test('no-answer cannot end an accepted owned call even when its epoch matches', async () => {
    const socket = new FakeSocket();
    socket.current = modernConnected;
    const controller = create(socket);
    await flush();
    socket.receive('call:noAnswer', { roomId: connected.roomId, ownershipRevision: 1 });
    expect(controller.snapshot.call).not.toBeNull();
    expect(jest.mocked(NativeVoiceMesh).mock.results[0].value.destroy).not.toHaveBeenCalled();
    socket.receive('call:ended', { roomId: connected.roomId });
    expect(controller.snapshot.call).toBeNull();
});
