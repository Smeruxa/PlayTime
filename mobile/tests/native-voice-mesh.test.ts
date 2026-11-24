import type { Socket } from 'socket.io-client';
import { RTCPeerConnection, type MediaStream } from 'react-native-webrtc';
import { NativeVoiceMesh } from '../src/features/calls/NativeVoiceMesh';
import { screenShareLimits } from '../src/features/calls/screenLimits';

jest.mock('react-native', () => ({
    Dimensions: { get: () => ({ width: 390, height: 844, scale: 1 }) },
    NativeModules: {},
    Platform: { OS: 'android', Version: 35 },
    PermissionsAndroid: { PERMISSIONS: {}, RESULTS: {} },
}));
jest.mock('react-native-webrtc', () => {
    class PeerConnection {
        videoMid = 1;
        signalingState = 'stable';
        connectionState = 'connected';
        iceConnectionState = 'connected';
        localDescription: { type: string; sdp: string } | null = null;
        remoteDescription: { type: string; sdp: string } | null = null;
        listeners = new Map<string, (() => void)[]>();
        senders: {
            track: { kind: string };
            getParameters: () => object;
            setParameters: () => Promise<void>;
        }[] = [];
        addEventListener(name: string, listener: () => void) {
            this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
        }
        state(value: string) {
            this.signalingState = value;
            this.listeners.get('signalingstatechange')?.forEach((listener) => listener());
        }
        addTrack(track: { kind: string }) {
            const sender = {
                track,
                getParameters: () => ({ encodings: [{}] }),
                setParameters: async () => {},
            };
            this.senders.push(sender);
            return sender;
        }
        removeTrack(sender: (typeof this.senders)[number]) {
            this.senders = this.senders.filter((item) => item !== sender);
        }
        async createOffer() {
            return {
                type: 'offer',
                sdp:
                    (this.senders.some((sender) => sender.track.kind === 'audio')
                        ? 'm=audio\r\na=mid:0\r\n'
                        : '') +
                    (this.senders.some((sender) => sender.track.kind === 'video')
                        ? `m=video\r\na=mid:${this.videoMid}\r\n`
                        : ''),
            };
        }
        async createAnswer() {
            return { type: 'answer', sdp: this.remoteDescription!.sdp };
        }
        async setLocalDescription(description: { type: string; sdp: string }) {
            if (description.type === 'rollback' && this.localDescription?.sdp.includes('m=video')) {
                this.videoMid++;
            }
            this.localDescription = description;
            this.state(description.type === 'offer' ? 'have-local-offer' : 'stable');
        }
        async setRemoteDescription(description: { type: string; sdp: string }) {
            this.remoteDescription = description;
            this.state(description.type === 'offer' ? 'have-remote-offer' : 'stable');
        }
        close() {
            this.state('closed');
        }
    }
    return {
        RTCPeerConnection: jest.fn().mockImplementation(() => new PeerConnection()),
        RTCSessionDescription: class {
            constructor(value: object) {
                Object.assign(this, value);
            }
        },
        RTCIceCandidate: class {},
        MediaStream: class {},
    };
});

function stream(kind: 'audio' | 'video'): MediaStream {
    const track = {
        kind,
        id: kind,
        enabled: true,
        stop: jest.fn(),
        getSettings: () => ({ width: 390, height: 844 }),
    };
    return {
        getTracks: () => [track],
        getAudioTracks: () => (kind === 'audio' ? [track] : []),
        getVideoTracks: () => (kind === 'video' ? [track] : []),
        release: jest.fn(),
    } as unknown as MediaStream;
}
const flush = async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
};

test('polite Android peer reoffers its screen after a colliding audio-only web offer', async () => {
    const socket = { connected: true, emit: jest.fn() };
    const mesh = new NativeVoiceMesh(
        socket as unknown as Socket,
        {
            roomId: '1:2',
            context: 'direct',
            title: 'guest',
            phase: 'connected',
            incoming: false,
            participants: [
                { userId: 1, username: 'Android' },
                { userId: 2, username: 'Guest' },
            ],
        },
        1,
        stream('audio'),
        [],
        jest.fn(),
        jest.fn(),
        () => 1,
    );
    try {
        await mesh.offer(2, 'Guest');
        await mesh.signal({
            roomId: '1:2',
            context: 'direct',
            fromUserId: 2,
            type: 'answer',
            payload: { type: 'answer', sdp: 'm=audio\r\n' },
        });
        await mesh.setScreen(stream('video'), screenShareLimits(null));
        const videoOffers = () =>
            socket.emit.mock.calls.filter(
                ([event, message]) =>
                    event === 'webrtc:signal' &&
                    message.type === 'offer' &&
                    message.payload.sdp.includes('m=video'),
            );
        expect(videoOffers()).toHaveLength(1);
        await mesh.signal({
            roomId: '1:2',
            context: 'direct',
            fromUserId: 2,
            type: 'offer',
            payload: { type: 'offer', sdp: 'm=audio\r\n' },
        });
        await flush();
        expect(videoOffers()).toHaveLength(2);
        await mesh.signal({
            roomId: '1:2',
            context: 'direct',
            fromUserId: 2,
            type: 'answer',
            payload: { type: 'answer', sdp: 'm=audio\r\nm=video\r\n' },
        });
        await flush();
        expect(videoOffers()).toHaveLength(2);
    } finally {
        mesh.destroy();
    }
});

function peer(userId: number, remoteId: number) {
    const socket = { connected: true, emit: jest.fn() };
    const roomId = `${userId}:${remoteId}`;
    const mesh = new NativeVoiceMesh(
        socket as unknown as Socket,
        {
            roomId,
            context: 'direct',
            title: 'Guest',
            phase: 'connected',
            incoming: false,
            participants: [
                { userId, username: 'Android' },
                { userId: remoteId, username: 'Guest' },
            ],
        },
        userId,
        stream('audio'),
        [],
        jest.fn(),
        jest.fn(),
        () => 1,
    );
    const signal = (type: 'offer' | 'answer', sdp = 'm=audio\r\n') =>
        mesh.signal({
            roomId,
            context: 'direct',
            fromUserId: remoteId,
            type,
            payload: { type, sdp },
        });
    const offers = () =>
        socket.emit.mock.calls
            .filter(([event, message]) => event === 'webrtc:signal' && message.type === 'offer')
            .map(([, message]) => message.payload.sdp as string);
    return { mesh, signal, offers };
}

test('impolite Android retains its screen offer when the web peer also offers', async () => {
    const { mesh, signal, offers } = peer(3, 2);
    try {
        await mesh.offer(2, 'Guest');
        await signal('answer');
        await mesh.setScreen(stream('video'), screenShareLimits(null));
        await signal('offer');
        await signal('answer', 'm=audio\r\nm=video\r\n');
        await flush();
        expect(offers().filter((sdp) => sdp.includes('m=video'))).toHaveLength(1);
        expect(offers().at(-1)).toContain('m=audio');
    } finally {
        mesh.destroy();
    }
});

test('screen selected during a pending voice offer is negotiated after its answer', async () => {
    const { mesh, signal, offers } = peer(1, 2);
    try {
        await mesh.offer(2, 'Guest');
        await mesh.setScreen(stream('video'), screenShareLimits(null));
        expect(offers()).toHaveLength(1);
        await signal('answer');
        await flush();
        expect(offers()).toHaveLength(2);
        expect(offers().at(-1)).toContain('m=video');
        expect(offers().at(-1)).toContain('m=audio');
        await signal('answer', 'm=audio\r\nm=video\r\n');
        await mesh.setScreen(null, screenShareLimits(null));
        expect(offers().at(-1)).not.toContain('m=video');
        expect(offers().at(-1)).toContain('m=audio');
    } finally {
        mesh.destroy();
    }
});

test('a lost initial direct-call offer is replayed with the same SDP and peer connection', async () => {
    jest.useFakeTimers();
    const previousConnections = jest.mocked(RTCPeerConnection).mock.calls.length;
    const { mesh, offers } = peer(1, 2);
    try {
        await mesh.offer(2, 'Guest');
        const initial = offers()[0];
        jest.advanceTimersByTime(1000);
        await flush();
        expect(offers()).toEqual([initial, initial]);
        jest.advanceTimersByTime(20000);
        await flush();
        expect(offers()).toHaveLength(21);
        jest.advanceTimersByTime(60000);
        await flush();
        expect(offers()).toHaveLength(21);
        expect(offers().every((sdp) => sdp === initial)).toBe(true);
        expect(jest.mocked(RTCPeerConnection).mock.calls.length).toBe(previousConnections + 1);
    } finally {
        mesh.destroy();
        jest.useRealTimers();
    }
});

test('answering, removing or disposing the peer cancels pending startup replay', async () => {
    jest.useFakeTimers();
    try {
        for (const action of ['answer', 'remove', 'dispose']) {
            const { mesh, signal, offers } = peer(1, 2);
            await mesh.offer(2, 'Guest');
            jest.advanceTimersByTime(1000);
            await flush();
            expect(offers()).toHaveLength(2);
            if (action === 'answer') await signal('answer');
            else if (action === 'remove') mesh.remove(2);
            else mesh.destroy();
            jest.advanceTimersByTime(20000);
            await flush();
            expect(offers()).toHaveLength(2);
            mesh.destroy();
        }
    } finally {
        jest.useRealTimers();
    }
});

test.each([4000, 9000])(
    'a web receiver delayed %i ms can answer without another microphone or peer',
    async (delayMs) => {
        jest.useFakeTimers();
        const previousConnections = jest.mocked(RTCPeerConnection).mock.calls.length;
        const { mesh, signal, offers } = peer(1, 2);
        try {
            await mesh.offer(2, 'Guest');
            const original = offers()[0];
            jest.advanceTimersByTime(delayMs);
            await flush();
            expect(offers()).toHaveLength(1 + delayMs / 1000);
            expect(offers().at(-1)).toBe(original);
            await signal('answer');
            jest.advanceTimersByTime(30000);
            await flush();
            expect(offers()).toHaveLength(1 + delayMs / 1000);
            expect(jest.mocked(RTCPeerConnection).mock.calls.length).toBe(previousConnections + 1);
        } finally {
            mesh.destroy();
            jest.useRealTimers();
        }
    },
);

test('foreground recovery preserves a pending screen SDP and restarts ICE once after its answer', async () => {
    jest.useFakeTimers();
    const { mesh, signal, offers } = peer(1, 2);
    try {
        await mesh.offer(2, 'Guest');
        await signal('answer');
        const pc = jest.mocked(RTCPeerConnection).mock.results.at(-1)!.value as RTCPeerConnection;
        const descriptions = jest.spyOn(pc, 'setLocalDescription');
        const creates = jest.spyOn(pc, 'createOffer');
        await mesh.setScreen(stream('video'), screenShareLimits(null));
        const pending = offers().at(-1)!;
        expect(pending).toContain('a=mid:1');
        const pendingCount = offers().length;
        creates.mockClear();
        mesh.reconnect();
        mesh.reconnect();
        jest.advanceTimersByTime(0);
        await flush();
        expect(
            descriptions.mock.calls.some(([description]) => description?.type === 'rollback'),
        ).toBe(false);
        expect(creates).not.toHaveBeenCalled();
        expect(offers()).toHaveLength(pendingCount + 1);
        expect(offers().at(-1)).toBe(pending);
        await signal('answer', pending);
        await flush();
        expect(creates).toHaveBeenCalledTimes(1);
        expect(creates).toHaveBeenLastCalledWith({ iceRestart: true });
        expect(offers().at(-1)).toContain('a=mid:1');
        expect(offers().at(-1)).not.toContain('a=mid:2');
        await signal('answer', offers().at(-1));
        await flush();
        jest.advanceTimersByTime(10000);
        await flush();
        expect(creates).toHaveBeenCalledTimes(1);
    } finally {
        mesh.destroy();
        jest.useRealTimers();
    }
});

test('stable recovery still restarts ICE and removing the peer cancels recovery timers', async () => {
    jest.useFakeTimers();
    const { mesh, signal } = peer(1, 2);
    try {
        await mesh.offer(2, 'Guest');
        await signal('answer');
        const pc = jest.mocked(RTCPeerConnection).mock.results.at(-1)!.value as RTCPeerConnection;
        const creates = jest.spyOn(pc, 'createOffer');
        mesh.reconnect();
        jest.advanceTimersByTime(0);
        await flush();
        expect(creates).toHaveBeenCalledTimes(1);
        expect(creates).toHaveBeenLastCalledWith({ iceRestart: true });
        await signal('answer');
        mesh.reconnect();
        mesh.remove(2);
        jest.advanceTimersByTime(10000);
        await flush();
        expect(creates).toHaveBeenCalledTimes(1);
    } finally {
        mesh.destroy();
        jest.useRealTimers();
    }
});

test('recovery waits for a remote offer answer and consumes one queued ICE restart', async () => {
    jest.useFakeTimers();
    const { mesh, signal } = peer(1, 2);
    try {
        await mesh.offer(2, 'Guest');
        await signal('answer');
        const pc = jest.mocked(RTCPeerConnection).mock.results.at(-1)!.value as RTCPeerConnection;
        const creates = jest.spyOn(pc, 'createOffer');
        const descriptions = jest.spyOn(pc, 'setLocalDescription');
        let release!: () => void;
        jest.spyOn(pc, 'createAnswer').mockImplementationOnce(async () => {
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            return { type: 'answer', sdp: 'm=audio\r\n' };
        });
        const incoming = signal('offer');
        await flush();
        expect(pc.signalingState).toBe('have-remote-offer');
        mesh.reconnect();
        mesh.reconnect();
        jest.advanceTimersByTime(0);
        await flush();
        expect(creates).not.toHaveBeenCalled();
        release();
        await incoming;
        await flush();
        expect(
            descriptions.mock.calls.some(([description]) => description?.type === 'rollback'),
        ).toBe(false);
        expect(creates).toHaveBeenCalledTimes(1);
        expect(creates).toHaveBeenLastCalledWith({ iceRestart: true });
    } finally {
        mesh.destroy();
        jest.useRealTimers();
    }
});

test('modern direct epochs fence stale signals and replace only the remote PC while retaining local media', async () => {
    const socket = { connected: true, emit: jest.fn() };
    const microphone = stream('audio');
    const screen = stream('video');
    const before = jest.mocked(RTCPeerConnection).mock.calls.length;
    const mesh = new NativeVoiceMesh(
        socket as unknown as Socket,
        {
            roomId: '1:2:owned',
            context: 'direct',
            title: 'Guest',
            phase: 'connected',
            incoming: false,
            ownershipRevision: 1,
            participants: [
                { userId: 1, username: 'Android', ownershipRevision: 1 },
                { userId: 2, username: 'Guest', ownershipRevision: 3 },
            ],
        },
        1,
        microphone,
        [],
        jest.fn(),
        jest.fn(),
        () => 1,
    );
    const answer = (fromOwnershipRevision: number, targetOwnershipRevision = 1) =>
        mesh.signal({
            roomId: '1:2:owned',
            context: 'direct',
            fromUserId: 2,
            type: 'answer',
            fromOwnershipRevision,
            targetOwnershipRevision,
            payload: { type: 'answer', sdp: 'm=audio\r\nm=video\r\n' },
        });
    try {
        await answer(2);
        await answer(3, 0);
        expect(jest.mocked(RTCPeerConnection).mock.calls.length).toBe(before);
        await mesh.offer(2, 'Guest');
        expect(socket.emit).toHaveBeenCalledWith(
            'webrtc:signal',
            expect.objectContaining({
                ownershipRevision: 1,
                targetOwnershipRevision: 3,
            }),
        );
        const oldPc = jest.mocked(RTCPeerConnection).mock.results.at(-1)!
            .value as RTCPeerConnection;
        const close = jest.spyOn(oldPc, 'close');
        await answer(3);
        await mesh.setScreen(screen, screenShareLimits(null));
        await answer(3);
        expect(mesh.replacePeer(2, 4)).toBe(true);
        expect(close).toHaveBeenCalledTimes(1);
        expect(mesh.replacePeer(2, 3)).toBe(false);
        await mesh.offer(2, 'Guest');
        const freshPc = jest.mocked(RTCPeerConnection).mock.results.at(-1)!
            .value as RTCPeerConnection;
        expect(jest.mocked(RTCPeerConnection).mock.calls.length).toBe(before + 2);
        expect(freshPc.localDescription?.sdp).toContain('m=audio');
        expect(freshPc.localDescription?.sdp).toContain('m=video');
        expect(microphone.getTracks()[0].stop).not.toHaveBeenCalled();
        expect(screen.getTracks()[0].stop).not.toHaveBeenCalled();
        await answer(3);
        expect(freshPc.remoteDescription).toBeNull();
        await answer(4);
        expect(freshPc.remoteDescription).not.toBeNull();
        await mesh.setScreen(screen, screenShareLimits(null));
        expect(socket.emit).toHaveBeenCalledWith(
            'webrtc:screen:state',
            expect.objectContaining({
                active: true,
                ownershipRevision: 1,
                targetOwnershipRevision: 4,
            }),
        );
    } finally {
        mesh.destroy();
    }
});

test('an asynchronous offer from a replaced peer cannot fail or overwrite the fresh connection', async () => {
    const { mesh, signal, offers } = peer(1, 2);
    try {
        await mesh.offer(2, 'Guest');
        await signal('answer');
        const oldPc = jest.mocked(RTCPeerConnection).mock.results.at(-1)!
            .value as RTCPeerConnection;
        let rejectOld!: (error: Error) => void;
        jest.spyOn(oldPc, 'createOffer').mockImplementationOnce(
            () =>
                new Promise((_resolve, reject) => {
                    rejectOld = reject;
                }),
        );
        const pending = mesh.offer(2, 'Guest');
        await flush();
        expect(mesh.replacePeer(2, 1)).toBe(true);
        await mesh.offer(2, 'Guest');
        const freshPc = jest.mocked(RTCPeerConnection).mock.results.at(-1)!
            .value as RTCPeerConnection;
        rejectOld(new Error('Old peer connection is closed'));
        await expect(pending).resolves.toBeUndefined();
        expect(freshPc.signalingState).toBe('have-local-offer');
        expect(offers()).toHaveLength(2);
    } finally {
        mesh.destroy();
    }
});
