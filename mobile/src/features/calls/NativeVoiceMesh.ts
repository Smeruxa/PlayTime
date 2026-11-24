import {
    MediaStream,
    RTCPeerConnection,
    RTCIceCandidate,
    RTCSessionDescription,
    type RTCRtpSender,
    type MediaStreamTrack,
} from 'react-native-webrtc';
import { Dimensions } from 'react-native';
import type { Socket } from 'socket.io-client';
import type { ActiveCall, CallScreenStream, IceServer, Signal } from './types';
import { screenResolutionScale, screenShareLimits, type ScreenShareLimits } from './screenLimits';
import { native } from './nativeAudio';

type Peer = {
    id: number;
    username: string;
    pc: RTCPeerConnection;
    tail: Promise<void>;
    makingOffer: boolean;
    ignoreOffer: boolean;
    negotiationRequested: boolean;
    restartRequested: boolean;
    pendingIce: Signal['payload'][];
    restartTimer?: ReturnType<typeof setTimeout>;
    startupOfferTimer?: ReturnType<typeof setTimeout>;
    remoteStreams: Map<string, MediaStream>;
    screenSenders: RTCRtpSender[];
    microphoneSender?: RTCRtpSender;
};

const STARTUP_OFFER_REPLAY_MS = 1000;
const STARTUP_OFFER_REPLAY_LIMIT = 20;

export class NativeVoiceMesh {
    private peers = new Map<number, Peer>();
    private screens = new Map<number, CallScreenStream>();
    private disposed = false;
    private screen: MediaStream | null = null;
    private screenLimits = screenShareLimits(null);
    private microphoneOverride: MediaStreamTrack | null = null;
    private muted = false;
    private remoteOwnership = new Map<number, number>();

    constructor(
        private socket: Socket,
        private call: ActiveCall,
        private userId: number,
        private microphone: MediaStream,
        private iceServers: IceServer[],
        private changed: (screens: CallScreenStream[], connected: boolean) => void,
        private fail: (message: string) => void,
        private volume: (userId: number, screen: boolean) => number,
    ) {
        for (const participant of call.participants) {
            if (participant.userId !== userId && participant.ownershipRevision !== undefined) {
                this.remoteOwnership.set(participant.userId, participant.ownershipRevision);
            }
        }
    }

    private publish() {
        if (this.disposed) {
            return;
        }
        this.changed(
            [...this.screens.values()],
            [...this.peers.values()].some((peer) => peer.pc.connectionState === 'connected'),
        );
    }

    private send(peer: Peer, type: Signal['type'], payload: object) {
        if (this.disposed || !this.socket.connected || this.peers.get(peer.id) !== peer) {
            return;
        }
        this.socket.emit('webrtc:signal', {
            roomId: this.call.roomId,
            context: this.call.context,
            targetUserId: peer.id,
            ...(this.call.context === 'direct' && this.call.ownershipRevision !== undefined
                ? {
                      ownershipRevision: this.call.ownershipRevision,
                      targetOwnershipRevision: this.remoteOwnership.get(peer.id),
                  }
                : {}),
            type,
            payload,
        });
    }

    private operation(peer: Peer, action: () => Promise<void>) {
        const work = peer.tail
            .then(async () => {
                if (
                    !this.disposed &&
                    this.peers.get(peer.id) === peer &&
                    peer.pc.signalingState !== 'closed'
                ) {
                    await action();
                }
            })
            .catch((error: unknown) => {
                if (
                    this.disposed ||
                    this.peers.get(peer.id) !== peer ||
                    peer.pc.signalingState === 'closed'
                ) {
                    return;
                }
                throw error;
            });
        peer.tail = work.catch(() => {});
        return work;
    }

    private getPeer(id: number, username: string): Peer {
        const existing = this.peers.get(id);
        if (existing) {
            if (username) {
                existing.username = username;
            }
            return existing;
        }
        const pc = new RTCPeerConnection({
            iceServers: this.iceServers.map((server) => ({
                ...server,
                urls: Array.isArray(server.urls) ? [...server.urls] : server.urls,
            })),
        });
        const peer: Peer = {
            id,
            username,
            pc,
            tail: Promise.resolve(),
            makingOffer: false,
            ignoreOffer: false,
            negotiationRequested: false,
            restartRequested: false,
            pendingIce: [],
            remoteStreams: new Map(),
            screenSenders: [],
        };
        this.peers.set(id, peer);
        const voice = this.microphoneOverride ?? this.microphone.getAudioTracks()[0];
        if (voice) {
            peer.microphoneSender = pc.addTrack(voice, this.microphone);
        }
        if (this.screen) {
            this.screen
                .getTracks()
                .forEach((track) => peer.screenSenders.push(pc.addTrack(track, this.screen!)));
        }

        pc.addEventListener('icecandidate', (event) => {
            if (event.candidate) {
                this.send(peer, 'ice', event.candidate.toJSON());
            }
        });
        pc.addEventListener('track', (event) => {
            if (!event.track) {
                return;
            }
            const stream = event.streams[0] ?? new MediaStream([event.track]);
            peer.remoteStreams.set(stream.id, stream);
            this.classifyStreams(peer);
            event.track.addEventListener('ended', () => {
                this.classifyStreams(peer);
            });
        });
        const connectionChanged = () => {
            if (this.disposed || this.peers.get(id) !== peer) {
                return;
            }
            if (pc.connectionState === 'connected') {
                clearTimeout(peer.restartTimer);
                peer.restartTimer = undefined;
            } else if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
                this.scheduleRestart(peer, 0);
            } else if (pc.connectionState === 'disconnected') {
                this.scheduleRestart(peer, 1200);
            }
            this.publish();
        };
        pc.addEventListener('connectionstatechange', connectionChanged);
        pc.addEventListener('iceconnectionstatechange', connectionChanged);
        pc.addEventListener('signalingstatechange', () => {
            if (pc.signalingState === 'stable' && peer.negotiationRequested) {
                void this.offer(id, peer.username).catch(() => this.scheduleRestart(peer, 2000));
            }
        });
        return peer;
    }

    private classifyStreams(peer: Peer) {
        for (const stream of peer.remoteStreams.values()) {
            const isScreen = stream.getVideoTracks().some((track) => track.readyState === 'live');
            for (const track of stream.getAudioTracks()) {
                track._setVolume(this.volume(peer.id, isScreen));
            }
            if (isScreen) {
                this.screens.set(peer.id, {
                    userId: peer.id,
                    username: peer.username,
                    stream,
                });
            } else if (this.screens.get(peer.id)?.stream.id === stream.id) {
                this.screens.delete(peer.id);
            }
        }
        this.publish();
    }

    applyVolumes() {
        for (const peer of this.peers.values()) {
            this.classifyStreams(peer);
        }
    }

    private scheduleRestart(peer: Peer, delay: number) {
        if (this.disposed || peer.restartTimer) {
            return;
        }
        peer.restartTimer = setTimeout(() => {
            peer.restartTimer = undefined;
            if (this.disposed || this.peers.get(peer.id) !== peer) {
                return;
            }
            if (!this.socket.connected) {
                return;
            }
            void this.operation(peer, async () => {
                peer.restartRequested = true;
                if (peer.makingOffer || peer.pc.signalingState !== 'stable') {
                    peer.negotiationRequested = true;
                    const pending = peer.pc.localDescription;
                    if (
                        peer.pc.signalingState === 'have-local-offer' &&
                        pending?.type === 'offer' &&
                        pending.sdp
                    ) {
                        this.send(peer, 'offer', { type: pending.type, sdp: pending.sdp });
                    }
                    return;
                }
                await this.makeOffer(peer);
            })
                .catch(() => {
                    this.fail('Соединение с участником прервалось. Восстанавливаем звук…');
                })
                .finally(() => {
                    if (!this.disposed && peer.pc.connectionState !== 'connected') {
                        this.scheduleRestart(peer, 5000);
                    }
                });
        }, delay);
    }

    private scheduleStartupOfferReplay(peer: Peer, attempt = 0): void {
        clearTimeout(peer.startupOfferTimer);
        peer.startupOfferTimer = undefined;
        if (
            this.call.context !== 'direct' ||
            peer.pc.remoteDescription ||
            peer.pc.signalingState !== 'have-local-offer' ||
            attempt >= STARTUP_OFFER_REPLAY_LIMIT
        ) {
            return;
        }
        peer.startupOfferTimer = setTimeout(() => {
            peer.startupOfferTimer = undefined;
            if (
                this.disposed ||
                this.peers.get(peer.id) !== peer ||
                !this.socket.connected ||
                peer.pc.remoteDescription ||
                peer.pc.signalingState !== 'have-local-offer'
            ) {
                return;
            }
            const description = peer.pc.localDescription;
            if (description?.type !== 'offer' || !description.sdp) {
                return;
            }
            this.send(peer, 'offer', { type: description.type, sdp: description.sdp });
            this.scheduleStartupOfferReplay(peer, attempt + 1);
        }, STARTUP_OFFER_REPLAY_MS);
    }

    private async makeOffer(peer: Peer) {
        if (!this.socket.connected || this.disposed) {
            return;
        }
        if (peer.makingOffer || peer.pc.signalingState !== 'stable') {
            peer.negotiationRequested = true;
            return;
        }
        const iceRestart = peer.restartRequested;
        peer.restartRequested = false;
        if (iceRestart) {
            clearTimeout(peer.restartTimer);
            peer.restartTimer = undefined;
        }
        peer.makingOffer = true;
        peer.negotiationRequested = false;
        try {
            const offer = await peer.pc.createOffer(iceRestart ? { iceRestart: true } : {});
            if (this.disposed || this.peers.get(peer.id) !== peer) {
                return;
            }
            await peer.pc.setLocalDescription(offer);
            if (this.disposed || this.peers.get(peer.id) !== peer) {
                return;
            }
            await this.applyScreenEncodings(peer);
            this.send(peer, 'offer', offer);
            this.scheduleStartupOfferReplay(peer);
        } catch (error) {
            if (iceRestart) {
                peer.restartRequested = true;
            }
            throw error;
        } finally {
            peer.makingOffer = false;
        }
    }

    offer(userId: number, username: string) {
        if (userId === this.userId || this.disposed) {
            return Promise.resolve();
        }
        const peer = this.getPeer(userId, username);
        return this.operation(peer, () => this.makeOffer(peer));
    }

    async signal(message: Signal) {
        if (
            this.disposed ||
            message.fromUserId === this.userId ||
            message.context !== this.call.context ||
            String(message.roomId) !== String(this.call.roomId)
        ) {
            return;
        }
        if (this.call.context === 'direct' && this.call.ownershipRevision !== undefined) {
            const remoteRevision = this.remoteOwnership.get(message.fromUserId);
            if (
                remoteRevision === undefined ||
                message.targetOwnershipRevision !== this.call.ownershipRevision ||
                message.fromOwnershipRevision !== remoteRevision
            ) {
                return;
            }
        }
        const peer = this.getPeer(message.fromUserId, message.fromUsername ?? 'Участник');
        await this.operation(peer, async () => {
            if (message.type === 'ice') {
                if (peer.ignoreOffer) {
                    return;
                }
                if (!peer.pc.remoteDescription) {
                    if (peer.pendingIce.length < 256) {
                        peer.pendingIce.push(message.payload);
                    }
                    return;
                }
                try {
                    await peer.pc.addIceCandidate(new RTCIceCandidate(message.payload));
                } catch {}
                return;
            }
            const payload = message.payload;
            if (!payload.sdp || !payload.type) {
                return;
            }
            if (message.type === 'offer') {
                const collision = peer.makingOffer || peer.pc.signalingState !== 'stable';
                peer.ignoreOffer = this.userId > message.fromUserId && collision;
                if (peer.ignoreOffer) {
                    return;
                }
                const rolledBack = collision && peer.pc.signalingState === 'have-local-offer';
                if (rolledBack) {
                    await peer.pc.setLocalDescription({ type: 'rollback', sdp: '' });
                }
                await peer.pc.setRemoteDescription(
                    new RTCSessionDescription({ type: 'offer', sdp: payload.sdp }),
                );
                clearTimeout(peer.startupOfferTimer);
                peer.startupOfferTimer = undefined;
                if (rolledBack) {
                    peer.negotiationRequested = true;
                }
                await this.flushIce(peer);
                const answer = await peer.pc.createAnswer();
                await peer.pc.setLocalDescription(answer);
                await this.applyScreenEncodings(peer);
                this.send(peer, 'answer', answer);
            } else {
                if (peer.pc.signalingState !== 'have-local-offer') {
                    return;
                }
                await peer.pc.setRemoteDescription(
                    new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }),
                );
                clearTimeout(peer.startupOfferTimer);
                peer.startupOfferTimer = undefined;
                peer.ignoreOffer = false;
                await this.flushIce(peer);
                await this.applyScreenEncodings(peer);
            }
        });
    }

    private async flushIce(peer: Peer) {
        for (const candidate of peer.pendingIce.splice(0)) {
            try {
                await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch {}
        }
    }

    setMuted(muted: boolean) {
        this.muted = muted;
        this.microphone.getAudioTracks().forEach((track) => {
            track.enabled = !muted;
        });
        if (this.microphoneOverride) {
            this.microphoneOverride.enabled = !muted;
        }
    }

    async replaceMicrophoneTrack(track: MediaStreamTrack | null) {
        if (this.disposed) {
            return;
        }
        this.microphoneOverride = track;
        const active = track ?? this.microphone.getAudioTracks()[0];
        if (!active) {
            throw new Error('Источник микрофона недоступен');
        }
        active.enabled = !this.muted;
        for (const peer of [...this.peers.values()]) {
            await this.operation(peer, async () => {
                await peer.microphoneSender?.replaceTrack(active);
            });
        }
    }

    private async applyScreenEncodings(peer: Peer) {
        const display = Dimensions.get('screen');
        for (const sender of peer.screenSenders) {
            if (sender.track?.kind !== 'video') {
                continue;
            }
            const settings = sender.track.getSettings();
            const parameters = sender.getParameters();
            if (!parameters.encodings?.length) {
                continue;
            }
            for (const encoding of parameters.encodings) {
                encoding.maxFramerate = this.screenLimits.maxFps;
                encoding.scaleResolutionDownBy = native?.configureScreenCapture
                    ? 1
                    : screenResolutionScale(
                          settings.width ?? display.width * display.scale,
                          settings.height ?? display.height * display.scale,
                          this.screenLimits.targetLongSide,
                      );
            }
            await sender.setParameters(parameters);
        }
    }

    async updateScreenLimits(limits: ScreenShareLimits) {
        this.screenLimits = limits;
        for (const peer of this.peers.values()) {
            await this.operation(peer, () => this.applyScreenEncodings(peer));
        }
    }

    async setScreen(stream: MediaStream | null, limits: ScreenShareLimits) {
        if (this.disposed) {
            return;
        }
        this.screen = stream;
        this.screenLimits = limits;
        for (const peer of [...this.peers.values()]) {
            await this.operation(peer, async () => {
                peer.screenSenders.forEach((sender) => peer.pc.removeTrack(sender));
                peer.screenSenders = [];
                if (stream) {
                    for (const track of stream.getTracks()) {
                        const sender = peer.pc.addTrack(track, stream);
                        peer.screenSenders.push(sender);
                    }
                }
                await this.makeOffer(peer);
            });
        }
        if (!this.disposed && this.socket.connected) {
            const remote = this.call.participants.find(
                (participant) => participant.userId !== this.userId,
            );
            this.socket.emit('webrtc:screen:state', {
                roomId: this.call.roomId,
                context: this.call.context,
                active: !!stream,
                ...(this.call.context === 'direct' && this.call.ownershipRevision !== undefined
                    ? {
                          ownershipRevision: this.call.ownershipRevision,
                          targetOwnershipRevision: remote
                              ? this.remoteOwnership.get(remote.userId)
                              : undefined,
                      }
                    : {}),
            });
        }
    }

    screenStopped(userId: number) {
        const screen = this.screens.get(userId);
        if (screen) {
            screen.stream.getAudioTracks().forEach((track) => track._setVolume(0));
            this.peers.get(userId)?.remoteStreams.delete(screen.stream.id);
        }
        this.screens.delete(userId);
        this.publish();
    }

    remove(userId: number) {
        const peer = this.peers.get(userId);
        if (!peer) {
            return;
        }
        clearTimeout(peer.restartTimer);
        clearTimeout(peer.startupOfferTimer);
        this.peers.delete(userId);
        this.screens.delete(userId);
        peer.pc.close();
        this.publish();
    }

    replacePeer(userId: number, ownershipRevision: number): boolean {
        if (
            this.disposed ||
            userId === this.userId ||
            !Number.isSafeInteger(ownershipRevision) ||
            ownershipRevision < 0 ||
            ownershipRevision <= (this.remoteOwnership.get(userId) ?? -1)
        ) {
            return false;
        }
        this.remoteOwnership.set(userId, ownershipRevision);
        this.remove(userId);
        return true;
    }

    reconnect() {
        for (const peer of this.peers.values()) {
            this.scheduleRestart(peer, 0);
        }
    }

    async ping(): Promise<number | null> {
        let rtt: number | null = null;
        for (const peer of this.peers.values()) {
            try {
                const report = await peer.pc.getStats();
                report.forEach(
                    (entry: {
                        type: string;
                        currentRoundTripTime?: number;
                        nominated?: boolean;
                        state?: string;
                    }) => {
                        if (
                            entry.type === 'candidate-pair' &&
                            (entry.nominated || entry.state === 'succeeded') &&
                            typeof entry.currentRoundTripTime === 'number'
                        ) {
                            rtt = Math.max(rtt ?? 0, Math.round(entry.currentRoundTripTime * 1000));
                        }
                    },
                );
            } catch {}
        }
        return rtt;
    }

    destroy() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.peers.forEach((peer) => {
            clearTimeout(peer.restartTimer);
            clearTimeout(peer.startupOfferTimer);
            peer.pc.close();
        });
        this.peers.clear();
        this.screens.clear();
        this.microphone.getTracks().forEach((track) => track.stop());
        this.microphoneOverride?.stop();
        this.microphone.release();
    }
}
