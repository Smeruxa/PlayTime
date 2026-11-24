import {
    AppState,
    DeviceEventEmitter,
    Dimensions,
    Linking,
    PermissionsAndroid,
    Platform,
    type NativeEventSubscription,
} from 'react-native';
import { MediaStream, MediaStreamTrack, mediaDevices } from 'react-native-webrtc';
import type { Socket } from 'socket.io-client';
import { NativeVoiceMesh } from './NativeVoiceMesh';
import { clampVolume, loadCallPreferences, saveCallPreferences } from './preferences';
import { native, MicrophonePermissionError, requestCallMicrophone } from './nativeAudio';
import type { PlanLimits } from '../../types';
import { screenResolutionScale, screenShareLimits } from './screenLimits';
import { detachScreenAudio } from './detachScreenAudio';
import type {
    AudioRoute,
    CallContext,
    CallParticipant,
    CallSnapshot,
    DirectCallState,
    IceServer,
    IncomingCall,
    Signal,
} from './types';

const errorText = (error: unknown) =>
    error instanceof Error ? error.message : 'Не удалось подключиться к звонку';

export class CallController {
    private state: CallSnapshot = {
        call: null,
        ongoingElsewhere: null,
        incoming: null,
        busy: false,
        sharingBusy: false,
        muted: false,
        speaker: false,
        interrupted: false,
        permissionBlocked: false,
        bluetoothPermission: null,
        error: null,
        localScreen: null,
        localSystemAudio: false,
        remoteScreens: [],
        screenAudioMuted: false,
        screenVolume: 100,
        masterVolume: 100,
        participantVolumes: {},
        rttMs: null,
        needsResume: false,
    };
    private listeners = new Set<(snapshot: CallSnapshot) => void>();
    private socket: Socket;
    private userId: number;
    private username: string;
    private mesh: NativeVoiceMesh | null = null;
    private mediaStarting: Promise<void> | null = null;
    private mediaCleanup: Promise<void> = Promise.resolve();
    private queuedSignals: Signal[] = [];
    private disposed = false;
    private foreground = AppState.currentState === 'active';
    private ringing: 'incoming' | 'outgoing' | null = null;
    private generation = 0;
    private eventSequence = 0;
    private preferenceRevision = 0;
    private preferenceWrite = Promise.resolve();
    private revision = new Map<string, number>();
    private ownershipRevision = new Map<string, number>();
    private remoteOwnershipRevision = new Map<string, number>();
    private directState: DirectCallState | null = null;
    private ended = new Set<string>();
    private iceServers: IceServer[] | null = null;
    private iceWaiting = new Set<(servers: IceServer[]) => void>();
    private bindings: Array<() => void> = [];
    private subscriptions: NativeEventSubscription[] = [];
    private ringTimer?: ReturnType<typeof setTimeout>;
    private retryTimer?: ReturnType<typeof setTimeout>;
    private heartbeat: ReturnType<typeof setInterval>;
    private poll: ReturnType<typeof setInterval>;
    private screenLimits = screenShareLimits(null);
    private screenAudioCleanup = Promise.resolve();
    private onError?: (message: string) => void;

    constructor(options: {
        socket: Socket;
        userId: number;
        username: string;
        onError?: (message: string) => void;
    }) {
        this.socket = options.socket;
        this.userId = options.userId;
        this.username = options.username;
        this.onError = options.onError;
        void loadCallPreferences(this.userId).then((preferences) => {
            if (!this.disposed && this.preferenceRevision === 0) {
                this.patch(preferences);
                this.mesh?.setMuted(this.state.muted || this.state.interrupted);
                this.mesh?.applyVolumes();
            }
        });
        this.bind('webrtc:config', (data: { iceServers?: IceServer[] }) => {
            if (!Array.isArray(data?.iceServers)) {
                return;
            }
            this.iceServers = data.iceServers;
            this.iceWaiting.forEach((resolve) => resolve(data.iceServers!));
            this.iceWaiting.clear();
        });
        this.bind('call:state', (data: DirectCallState) => this.applyDirectState(data));
        this.bind(
            'webrtc:peer:replaced',
            (data: {
                context: CallContext;
                roomId: string;
                userId: number;
                ownershipRevision: number;
            }) => {
                if (
                    data?.context !== 'direct' ||
                    !Number.isSafeInteger(data.userId) ||
                    data.userId === this.userId ||
                    !Number.isSafeInteger(data.ownershipRevision)
                ) {
                    return;
                }
                this.updateRemoteOwner(data.roomId, data.userId, data.ownershipRevision);
            },
        );
        this.bind('call:ownershipLost', (data: { roomId: string; ownershipRevision: number }) => {
            if (
                !data?.roomId ||
                this.ended.has(data.roomId) ||
                !Number.isSafeInteger(data.ownershipRevision)
            ) {
                return;
            }
            if (data.ownershipRevision < (this.ownershipRevision.get(data.roomId) ?? 0)) {
                return;
            }
            this.ownershipRevision.set(data.roomId, data.ownershipRevision);
            const previous = this.directState;
            if (previous?.roomId !== data.roomId) {
                return;
            }
            if (this.state.call?.context === 'direct' && this.state.call.roomId === data.roomId) {
                this.clearCall();
            }
            this.patch({
                ongoingElsewhere: {
                    ...previous,
                    media: {
                        active: false,
                        canClaim: false,
                        ownershipRevision: data.ownershipRevision,
                    },
                },
            });
            void this.recover();
        });
        this.bind('call:incomingCall', (data: IncomingCall) => {
            if (
                !data ||
                typeof data.roomId !== 'string' ||
                typeof data.from !== 'string' ||
                this.ended.has(data.roomId)
            ) {
                return;
            }
            if (
                (this.revision.get(data.roomId) ?? 0) >= 2 ||
                (data.expiresAt && data.expiresAt <= Date.now())
            ) {
                return;
            }
            this.eventSequence++;
            this.patch({ incoming: data });
            this.expireRing(data.roomId, data.expiresAt);
        });
        this.bind('call:confirmed', (data: { roomId?: string; ownershipRevision?: number }) => {
            if (!data?.roomId || this.ended.has(data.roomId)) {
                return;
            }
            const expectedOwnership = this.ownershipRevision.get(data.roomId);
            if (expectedOwnership !== undefined && data.ownershipRevision !== expectedOwnership) {
                void this.recover();
                return;
            }
            this.revision.set(data.roomId, Math.max(2, this.revision.get(data.roomId) ?? 0));
            if (this.state.call?.roomId === data.roomId) {
                this.eventSequence++;
                clearTimeout(this.ringTimer);
                this.patch({
                    call: {
                        ...this.state.call,
                        phase: this.state.call.phase === 'connected' ? 'connected' : 'connecting',
                    },
                });
                this.beginMedia();
            } else {
                void this.recover();
            }
        });
        for (const event of ['call:ended', 'call:rejected', 'call:noAnswer']) {
            this.bind(event, (data: { roomId?: string; ownershipRevision?: number }) => {
                if (!data?.roomId) {
                    return;
                }
                if (event === 'call:noAnswer') {
                    const expectedOwnership = this.ownershipRevision.get(data.roomId);
                    if (
                        (expectedOwnership !== undefined &&
                            data.ownershipRevision !== expectedOwnership) ||
                        (this.directState?.roomId === data.roomId &&
                            this.directState.status === 'in_call')
                    ) {
                        return;
                    }
                }
                this.eventSequence++;
                this.rememberEnded(data.roomId);
                if (this.state.incoming?.roomId === data.roomId) {
                    this.patch({ incoming: null });
                }
                if (this.state.call?.roomId === data.roomId) {
                    this.clearCall();
                    if (event === 'call:noAnswer') {
                        this.patch({ error: 'Собеседник не ответил' });
                    }
                }
                if (this.state.ongoingElsewhere?.roomId === data.roomId) {
                    this.patch({ ongoingElsewhere: null });
                }
            });
        }
        this.bind('webrtc:signal', (message: Signal) => {
            const call = this.state.call;
            if (
                !call ||
                message.context !== call.context ||
                String(message.roomId) !== String(call.roomId)
            ) {
                return;
            }
            if (
                !Number.isSafeInteger(message.fromUserId) ||
                message.fromUserId <= 0 ||
                message.fromUserId === this.userId
            ) {
                return;
            }
            if (call.phase === 'ringing') {
                return;
            }
            if (!this.matchesOwnership(message)) {
                return;
            }
            if (this.mesh) {
                void this.mesh
                    .signal(message)
                    .catch(() =>
                        this.fail('Не удалось согласовать аудиосоединение. Повторяем подключение…'),
                    );
            } else if (this.queuedSignals.length < 256) {
                this.queuedSignals.push(message);
            }
        });
        this.bind(
            'webrtc:screen:state',
            (message: {
                context: CallContext;
                roomId: string | number;
                active: boolean;
                fromUserId: number;
                fromOwnershipRevision?: number;
                targetOwnershipRevision?: number;
            }) => {
                if (
                    message.context === this.state.call?.context &&
                    String(message.roomId) === String(this.state.call.roomId) &&
                    this.matchesOwnership(message) &&
                    !message.active
                ) {
                    this.mesh?.screenStopped(message.fromUserId);
                }
            },
        );
        this.bind('party:participants:list', (list: CallParticipant[]) => {
            if (this.state.call?.context !== 'party' || !Array.isArray(list)) {
                return;
            }
            const participants = [
                ...new Map(
                    list
                        .filter((item) => Number.isSafeInteger(item.userId) && item.userId > 0)
                        .map((item) => [item.userId, item]),
                ).values(),
            ];
            this.patch({ call: { ...this.state.call, participants } });
            if (this.mesh) {
                for (const participant of participants) {
                    if (this.userId < participant.userId) {
                        void this.mesh
                            .offer(participant.userId, participant.username)
                            .catch((error) => this.fail(errorText(error)));
                    }
                }
            } else {
                this.beginMedia();
            }
        });
        this.bind('party:participant:joined', (participant: CallParticipant) => {
            const call = this.state.call;
            if (call?.context !== 'party' || participant.userId === this.userId) {
                return;
            }
            this.patch({
                call: {
                    ...call,
                    participants: [
                        ...call.participants.filter((p) => p.userId !== participant.userId),
                        participant,
                    ],
                },
            });
            if (this.mesh) {
                void this.mesh
                    .offer(participant.userId, participant.username)
                    .catch((error) => this.fail(errorText(error)));
            } else {
                this.beginMedia();
            }
        });
        this.bind('party:participant:left', (participant: CallParticipant) => {
            const call = this.state.call;
            if (call?.context !== 'party') {
                return;
            }
            this.mesh?.remove(participant.userId);
            this.patch({
                call: {
                    ...call,
                    participants: call.participants.filter((p) => p.userId !== participant.userId),
                },
            });
        });
        for (const event of ['party:roomClosed', 'room:removed', 'room:deleted']) {
            this.bind(event, (data: { roomId?: number }) => {
                if (
                    this.state.call?.context === 'party' &&
                    String(data?.roomId) === String(this.state.call.roomId)
                ) {
                    this.clearCall();
                    this.fail('Доступ к комнате завершён');
                }
            });
        }
        this.bind('disconnect', () => {
            this.iceServers = null;
            clearTimeout(this.retryTimer);
            if (this.state.call && this.state.call.phase !== 'ringing') {
                this.patch({ call: { ...this.state.call, phase: 'reconnecting' } });
            }
        });
        this.bind('connect', () => {
            this.socket.emit('webrtc:config:request');
            void this.recover();
        });
        this.subscriptions.push(
            AppState.addEventListener('change', (value) => {
                this.foreground = value === 'active';
                this.syncRinging();
                if (value === 'active') {
                    void this.recover();
                }
            }),
        );
        this.subscriptions.push(
            DeviceEventEmitter.addListener(
                'PlayTimeAudioFocus',
                (event: { interrupted: boolean }) => {
                    this.patch({ interrupted: !!event.interrupted });
                    this.mesh?.setMuted(this.state.muted || !!event.interrupted);
                },
            ),
        );
        this.subscriptions.push(
            DeviceEventEmitter.addListener('PlayTimeCallEndRequested', () => {
                this.end();
            }),
        );
        this.subscriptions.push(
            DeviceEventEmitter.addListener(
                'PlayTimeScreenAudioError',
                (event: { message?: string }) => {
                    if (this.state.localSystemAudio) {
                        void this.stopSharedSystemAudio(
                            event.message || 'Системный звук стал недоступен',
                        );
                    }
                },
            ),
        );
        this.heartbeat = setInterval(() => {
            if (this.socket.connected && this.state.call?.context === 'direct') {
                this.socket.emit('call:heartbeat', {
                    roomId: this.state.call.roomId,
                    ...(this.state.call.ownershipRevision !== undefined
                        ? { ownershipRevision: this.state.call.ownershipRevision }
                        : {}),
                });
            }
        }, 20000);
        this.poll = setInterval(() => {
            const generation = this.generation;
            void this.mesh?.ping().then((rttMs) => {
                if (generation === this.generation) {
                    this.patch({ rttMs });
                }
            });
        }, 5000);
        if (this.socket.connected) {
            this.socket.emit('webrtc:config:request');
            void this.recover();
        }
    }

    get snapshot() {
        return this.state;
    }
    get canShareSystemAudio() {
        return !!(
            native?.systemAudioSupported &&
            native.startSystemAudioShare &&
            native.setAutomaticAudioRecording
        );
    }

    async updateLimits(limits: PlanLimits | null) {
        const next = screenShareLimits(limits);
        if (
            next.maxFps === this.screenLimits.maxFps &&
            next.targetLongSide === this.screenLimits.targetLongSide
        ) {
            return;
        }
        this.screenLimits = next;
        const stream = this.state.localScreen;
        try {
            if (stream) {
                await this.configureScreen(stream);
            }
            await this.mesh?.updateScreenLimits(next);
        } catch {
            await this.stopScreenShare();
            this.fail('Лимиты демонстрации изменились. Запустите показ экрана ещё раз.');
        }
    }

    private async configureScreen(stream: MediaStream) {
        const video = stream.getVideoTracks()[0];
        if (video && native?.configureScreenCapture) {
            await native.configureScreenCapture(
                video.id,
                this.screenLimits.targetLongSide,
                this.screenLimits.maxFps,
            );
        }
    }

    private releaseSystemAudio() {
        this.screenAudioCleanup = this.screenAudioCleanup.then(async () => {
            await native?.stopSystemAudioShare?.().catch(() => {});
            await native?.setAutomaticAudioRecording?.(true).catch(() => {});
        });
        return this.screenAudioCleanup;
    }
    subscribe(listener: (snapshot: CallSnapshot) => void) {
        this.listeners.add(listener);
        listener(this.state);
        return () => {
            this.listeners.delete(listener);
        };
    }
    private patch(update: Partial<CallSnapshot>) {
        if (this.disposed) {
            return;
        }
        this.state = { ...this.state, ...update };
        this.syncRinging();
        this.listeners.forEach((listener) => listener(this.state));
    }
    private syncRinging() {
        const desired =
            !this.foreground || this.disposed
                ? null
                : this.state.incoming
                ? 'incoming'
                : this.state.call?.phase === 'ringing'
                ? 'outgoing'
                : null;
        if (desired === this.ringing) {
            return;
        }
        this.ringing = desired;
        if (desired) {
            void native?.startCallRinging?.(desired === 'incoming').catch(() => {});
        } else {
            void native?.stopCallRinging?.().catch(() => {});
        }
    }
    private fail(message: string) {
        this.patch({ error: message });
        this.onError?.(message);
    }
    clearError() {
        this.patch({ error: null });
    }
    openPermissionSettings() {
        return Linking.openSettings();
    }
    private bind<T>(event: string, handler: (payload: T) => void) {
        this.bindings.push(() => this.socket.off(event, handler));
        this.socket.on(event, handler);
    }
    private ack<T>(event: string, payload?: object): Promise<T> {
        if (!this.socket.connected) {
            return Promise.reject(new Error('Нет соединения с сервером'));
        }
        return new Promise((resolve, reject) => {
            const callback = (error: Error | null, result: T & { err?: string }) => {
                if (error) {
                    reject(
                        new Error('Сервер не ответил. Проверьте подключение и попробуйте снова.'),
                    );
                } else if (result?.err) {
                    reject(new Error(result.err));
                } else {
                    resolve(result);
                }
            };
            if (payload === undefined) {
                this.socket.timeout(8000).emit(event, callback);
            } else {
                this.socket.timeout(8000).emit(event, payload, callback);
            }
        });
    }
    private rememberEnded(roomId: string) {
        this.ended.add(roomId);
        if (this.ended.size > 100) {
            this.ended.delete(this.ended.values().next().value!);
        }
    }
    private expireRing(roomId: string, expiresAt?: number) {
        clearTimeout(this.ringTimer);
        this.ringTimer = setTimeout(() => {
            if (this.state.incoming?.roomId === roomId) {
                this.patch({ incoming: null });
            }
            if (this.state.call?.roomId === roomId && this.state.call.phase === 'ringing') {
                this.end();
                this.patch({ error: 'Собеседник не ответил' });
            }
        }, Math.max(0, (expiresAt ?? Date.now() + 60000) - Date.now()));
    }

    private matchesOwnership(message: {
        fromUserId: number;
        fromOwnershipRevision?: number;
        targetOwnershipRevision?: number;
    }): boolean {
        const call = this.state.call;
        if (!call || call.context !== 'direct' || call.ownershipRevision === undefined) {
            return true;
        }
        const remote = call.participants.find(
            (participant) => participant.userId === message.fromUserId,
        );
        return (
            remote?.ownershipRevision !== undefined &&
            message.targetOwnershipRevision === call.ownershipRevision &&
            message.fromOwnershipRevision === remote.ownershipRevision
        );
    }

    private updateRemoteOwner(roomId: string, userId: number, ownershipRevision: number) {
        const key = `${roomId}:${userId}`;
        if (ownershipRevision <= (this.remoteOwnershipRevision.get(key) ?? -1)) {
            return;
        }
        this.remoteOwnershipRevision.set(key, ownershipRevision);
        const call = this.state.call;
        if (
            !call ||
            call.context !== 'direct' ||
            String(call.roomId) !== roomId ||
            !call.participants.some((participant) => participant.userId === userId)
        ) {
            return;
        }
        const participants = call.participants.map((participant) =>
            participant.userId === userId ? { ...participant, ownershipRevision } : participant,
        );
        this.patch({ call: { ...call, participants } });
        if (this.mesh?.replacePeer(userId, ownershipRevision) && !call.incoming) {
            const peer = participants.find((participant) => participant.userId === userId)!;
            void this.mesh
                .offer(userId, peer.username)
                .catch((error) => this.fail(errorText(error)));
        }
    }

    private applyDirectState(data: DirectCallState) {
        if (
            !data ||
            typeof data.roomId !== 'string' ||
            !data.caller ||
            !data.receiver ||
            this.ended.has(data.roomId)
        ) {
            return;
        }
        if (data.caller.id !== this.userId && data.receiver.id !== this.userId) {
            return;
        }
        if (
            data.media !== undefined &&
            (!data.media ||
                typeof data.media.active !== 'boolean' ||
                typeof data.media.canClaim !== 'boolean' ||
                !Number.isSafeInteger(data.media.ownershipRevision) ||
                data.media.ownershipRevision < 0 ||
                (data.media.active && data.media.ownershipRevision === 0))
        ) {
            return;
        }
        if (
            [data.caller, data.receiver].some(
                (participant) =>
                    participant.ownershipRevision !== undefined &&
                    (!Number.isSafeInteger(participant.ownershipRevision) ||
                        participant.ownershipRevision < 0),
            )
        ) {
            return;
        }
        if ((this.revision.get(data.roomId) ?? 0) > data.revision) {
            return;
        }
        if (
            data.media &&
            data.media.ownershipRevision < (this.ownershipRevision.get(data.roomId) ?? 0)
        ) {
            return;
        }
        for (const participant of [data.caller, data.receiver]) {
            if (
                participant.id !== this.userId &&
                participant.ownershipRevision !== undefined &&
                participant.ownershipRevision <
                    (this.remoteOwnershipRevision.get(`${data.roomId}:${participant.id}`) ?? 0)
            ) {
                return;
            }
        }
        this.directState = data;
        if (data.media) {
            this.ownershipRevision.set(data.roomId, data.media.ownershipRevision);
        }
        this.eventSequence++;
        this.revision.set(data.roomId, data.revision);
        if (this.revision.size > 100) {
            this.revision.delete(this.revision.keys().next().value!);
        }
        const incoming = data.receiver.id === this.userId;
        if (data.media?.active === false && (data.status === 'in_call' || !incoming)) {
            if (this.state.call?.context === 'direct') {
                this.clearCall();
            }
            this.patch({ ongoingElsewhere: data, incoming: null });
            return;
        }
        if (data.status === 'request_receiver' && incoming) {
            if (!data.expiresAt || data.expiresAt > Date.now()) {
                this.patch({
                    incoming: {
                        roomId: data.roomId,
                        from: data.caller.username,
                        expiresAt: data.expiresAt,
                    },
                });
                this.expireRing(data.roomId, data.expiresAt);
            }
            return;
        }
        if (this.state.call && this.state.call.roomId !== data.roomId) {
            this.end();
        }
        const previous = this.state.call;
        this.patch({
            ongoingElsewhere: null,
            incoming: this.state.incoming?.roomId === data.roomId ? null : this.state.incoming,
            call: {
                roomId: data.roomId,
                context: 'direct',
                title: incoming ? data.caller.username : data.receiver.username,
                incoming,
                phase:
                    data.status === 'request_receiver'
                        ? 'ringing'
                        : previous?.phase === 'connected'
                        ? 'connected'
                        : 'connecting',
                participants: [
                    {
                        userId: data.caller.id,
                        username: data.caller.username,
                        ownershipRevision: data.caller.ownershipRevision,
                    },
                    {
                        userId: data.receiver.id,
                        username: data.receiver.username,
                        ownershipRevision: data.receiver.ownershipRevision,
                    },
                ],
                startedAt: previous?.startedAt,
                expiresAt: data.expiresAt,
                ownershipRevision: data.media?.ownershipRevision,
            },
        });
        for (const participant of [data.caller, data.receiver]) {
            if (participant.id !== this.userId && participant.ownershipRevision !== undefined) {
                this.updateRemoteOwner(data.roomId, participant.id, participant.ownershipRevision);
            }
        }
        if (data.status === 'request_receiver') {
            this.expireRing(data.roomId, data.expiresAt);
        } else {
            clearTimeout(this.ringTimer);
            this.beginMedia();
        }
    }

    private async permission() {
        try {
            await requestCallMicrophone();
            this.patch({ permissionBlocked: false });
        } catch (error) {
            this.patch({
                permissionBlocked: error instanceof MicrophonePermissionError && error.blocked,
            });
            throw error;
        }
    }

    async start(username: string, peerUserId?: number) {
        if (this.state.busy || this.disposed) {
            return;
        }
        if (this.state.call) {
            throw new Error('Сначала завершите текущий звонок');
        }
        const generation = this.generation;
        this.patch({ busy: true, error: null });
        try {
            await this.permission();
            if (this.disposed || generation !== this.generation) {
                return;
            }
            const response = await this.ack<{
                success?: boolean;
                roomId: string;
                confirmed?: boolean;
                state?: DirectCallState;
            }>('call:start', { username, peerUserId });
            if (this.disposed || generation !== this.generation) {
                if (response.roomId && this.socket.connected) {
                    this.socket.emit('call:end', {
                        roomId: response.roomId,
                        ...(response.state?.media
                            ? { ownershipRevision: response.state.media.ownershipRevision }
                            : {}),
                    });
                }
                return;
            }
            if (!response.success || !response.roomId) {
                throw new Error('Не удалось начать звонок');
            }
            if (response.state) {
                this.applyDirectState(response.state);
            } else {
                await this.recover();
            }
        } catch (error) {
            this.fail(errorText(error));
            throw error;
        } finally {
            this.patch({ busy: false });
        }
    }

    async accept() {
        const incoming = this.state.incoming;
        if (!incoming || this.state.busy) {
            return;
        }
        this.patch({ busy: true, error: null });
        try {
            await this.permission();
            if (this.state.incoming?.roomId !== incoming.roomId || this.disposed) {
                return;
            }
            if (this.state.call) {
                this.end();
            }
            const response = await this.ack<{
                success?: boolean;
                state?: DirectCallState;
            }>('call:confirm', { roomId: incoming.roomId, accept: true });
            if (response.state) {
                this.applyDirectState(response.state);
            } else {
                await this.recover();
            }
        } catch (error) {
            this.fail(errorText(error));
            throw error;
        } finally {
            this.patch({ busy: false });
        }
    }

    async claim() {
        const elsewhere = this.state.ongoingElsewhere;
        if (!elsewhere || this.state.busy || this.disposed) {
            return;
        }
        if (!elsewhere.media?.canClaim) {
            throw new Error('Обновите PlayTime на другом устройстве, чтобы перенести звонок.');
        }
        if (this.state.call) {
            throw new Error('Сначала завершите текущий звонок на этом устройстве.');
        }
        const generation = this.generation;
        this.patch({ busy: true, error: null });
        try {
            await this.permission();
            if (this.disposed || generation !== this.generation) {
                return;
            }
            const response = await this.ack<{ state?: DirectCallState }>('call:claim', {
                roomId: elsewhere.roomId,
                expectedOwnershipRevision: elsewhere.media.ownershipRevision,
            });
            if (this.disposed || generation !== this.generation) {
                return;
            }
            if (response.state?.media?.active === true) {
                this.applyDirectState(response.state);
            } else {
                await this.recover();
            }
        } catch (error) {
            if (!this.disposed && generation === this.generation) {
                await this.recover();
                this.fail(errorText(error));
            }
            throw error;
        } finally {
            if (generation === this.generation) {
                this.patch({ busy: false });
            }
        }
    }

    async reject() {
        const incoming = this.state.incoming;
        if (!incoming || this.state.busy) {
            return;
        }
        this.patch({ busy: true });
        try {
            await this.ack('call:confirm', {
                roomId: incoming.roomId,
                accept: false,
            });
            this.rememberEnded(incoming.roomId);
            if (this.state.incoming?.roomId === incoming.roomId) {
                this.patch({ incoming: null });
            }
        } catch (error) {
            this.fail(errorText(error));
            throw error;
        } finally {
            this.patch({ busy: false });
        }
    }

    async joinParty(roomId: number, title: string) {
        if (this.state.busy || this.disposed) {
            return;
        }
        if (this.state.call) {
            throw new Error('Сначала завершите текущий звонок');
        }
        if (!Number.isSafeInteger(roomId) || roomId <= 0) {
            throw new Error('Некорректная комната');
        }
        const generation = this.generation;
        this.patch({ busy: true, error: null });
        try {
            await this.permission();
            if (generation !== this.generation || this.disposed) {
                return;
            }
            this.patch({
                call: {
                    roomId,
                    context: 'party',
                    title,
                    phase: 'connecting',
                    incoming: false,
                    participants: [{ userId: this.userId, username: this.username }],
                },
            });
            await this.ensureMedia();
            const response = await this.ack<{ success?: boolean }>('room:enter', {
                roomId,
            });
            if (!response.success) {
                throw new Error('Не удалось войти в голосовую комнату');
            }
            const current = this.snapshot.call;
            if (generation === this.generation && current) {
                this.patch({
                    call: { ...current, phase: 'connected', startedAt: Date.now() },
                });
            }
        } catch (error) {
            this.end();
            this.fail(errorText(error));
            throw error;
        } finally {
            this.patch({ busy: false });
        }
    }

    end() {
        const call = this.state.call;
        if (call && this.socket.connected) {
            this.socket.emit(call.context === 'party' ? 'room:leave' : 'call:end', {
                roomId: call.roomId,
                ...(call.context === 'direct' && call.ownershipRevision !== undefined
                    ? { ownershipRevision: call.ownershipRevision }
                    : {}),
            });
            if (call.context === 'direct') {
                this.rememberEnded(String(call.roomId));
            }
        }
        this.clearCall();
    }

    private clearCall() {
        this.generation++;
        this.eventSequence++;
        clearTimeout(this.ringTimer);
        clearTimeout(this.retryTimer);
        this.mediaStarting = null;
        const screen = this.state.localScreen;
        detachScreenAudio(screen);
        screen?.getTracks().forEach((track) => track.stop());
        screen?.release();
        this.mesh?.destroy();
        this.mesh = null;
        void this.releaseSystemAudio();
        this.queuedSignals = [];
        const stoppingAudio = native?.stopCallAudio().catch(() => {});
        this.mediaCleanup = Promise.all([this.mediaCleanup, stoppingAudio]).then(() => {});
        this.patch({
            call: null,
            ongoingElsewhere: null,
            busy: false,
            sharingBusy: false,
            localScreen: null,
            localSystemAudio: false,
            remoteScreens: [],
            rttMs: null,
            needsResume: false,
            interrupted: false,
        });
    }

    private config(): Promise<IceServer[]> {
        if (this.iceServers) {
            return Promise.resolve(this.iceServers);
        }
        return new Promise((resolve) => {
            const finish = (servers: IceServer[]) => {
                clearTimeout(timer);
                this.iceWaiting.delete(finish);
                resolve(servers);
            };
            const timer = setTimeout(
                () => finish([{ urls: 'stun:stun.l.google.com:19302' }]),
                3500,
            );
            this.iceWaiting.add(finish);
            if (this.socket.connected) {
                this.socket.emit('webrtc:config:request');
            }
        });
    }

    private beginMedia() {
        if (AppState.currentState !== 'active' && !this.mesh) {
            this.patch({ needsResume: true });
            return;
        }
        const generation = this.generation;
        void this.ensureMedia().catch((error) => {
            if (this.disposed || generation !== this.generation) {
                return;
            }
            this.patch({ needsResume: true });
            this.fail(errorText(error));
        });
    }

    async resumeMedia() {
        this.patch({ error: null, needsResume: false });
        try {
            await this.permission();
            await this.ensureMedia();
        } catch (error) {
            this.patch({ needsResume: true });
            this.fail(errorText(error));
            throw error;
        }
    }

    private ensureMedia(): Promise<void> {
        if (this.mesh || this.disposed || !this.state.call || this.state.call.phase === 'ringing') {
            return Promise.resolve();
        }
        if (this.mediaStarting) {
            return this.mediaStarting;
        }
        const generation = this.generation;
        let call = this.state.call;
        let acquiredStream: MediaStream | null = null;
        const work = (async () => {
            await this.mediaCleanup;
            if (generation !== this.generation || this.disposed) {
                return;
            }
            if (
                Platform.OS === 'android' &&
                !(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO))
            ) {
                throw new MicrophonePermissionError(false);
            }
            if (generation !== this.generation || this.disposed) {
                return;
            }
            if (!native) {
                throw new Error('Аудиомодуль недоступен. Переустановите Android-сборку PlayTime.');
            }
            await native.startCallAudio(this.state.speaker);
            if (generation !== this.generation || this.disposed) {
                await this.mediaCleanup;
                return;
            }
            const stream = await mediaDevices.getUserMedia({
                audio: true,
                video: false,
            });
            acquiredStream = stream;
            if (generation !== this.generation || this.disposed) {
                stream.getTracks().forEach((track) => track.stop());
                stream.release();
                return;
            }
            const ice = await this.config();
            if (generation !== this.generation || this.disposed) {
                stream.getTracks().forEach((track) => track.stop());
                stream.release();
                return;
            }
            const currentCall = this.state.call;
            if (!currentCall) {
                stream.getTracks().forEach((track) => track.stop());
                stream.release();
                return;
            }
            call = currentCall;
            const mesh = new NativeVoiceMesh(
                this.socket,
                call,
                this.userId,
                stream,
                ice,
                (remoteScreens, connected) => {
                    if (generation !== this.generation) {
                        return;
                    }
                    const current = this.state.call;
                    this.patch({
                        remoteScreens,
                        call: current
                            ? {
                                  ...current,
                                  phase: connected
                                      ? 'connected'
                                      : current.phase === 'connected' &&
                                        current.context === 'direct'
                                      ? 'reconnecting'
                                      : current.phase,
                                  startedAt: connected
                                      ? current.startedAt ?? Date.now()
                                      : current.startedAt,
                              }
                            : null,
                    });
                },
                (message) => this.fail(message),
                (id, screenAudio) =>
                    screenAudio
                        ? this.state.screenAudioMuted
                            ? 0
                            : this.state.screenVolume / 100
                        : (((this.state.participantVolumes[id] ?? 100) / 100) *
                              this.state.masterVolume) /
                          100,
            );
            this.mesh = mesh;
            acquiredStream = null;
            mesh.setMuted(this.state.muted || this.state.interrupted);
            this.patch({ needsResume: false });
            for (const signal of this.queuedSignals.splice(0)) {
                await mesh.signal(signal);
            }
            if (generation !== this.generation || this.disposed || this.mesh !== mesh) {
                return;
            }
            if (call.context === 'direct') {
                const callerId = Number(String(call.roomId).split(':')[0]);
                if (callerId === this.userId) {
                    const peer = call.participants.find((item) => item.userId !== this.userId);
                    if (peer) {
                        await mesh.offer(peer.userId, peer.username);
                    }
                }
            } else {
                for (const peer of this.state.call?.participants ?? []) {
                    if (this.userId < peer.userId) {
                        await mesh.offer(peer.userId, peer.username);
                    }
                }
            }
        })()
            .catch(async (error) => {
                acquiredStream?.getTracks().forEach((track) => track.stop());
                acquiredStream?.release();
                if (generation === this.generation) {
                    this.mesh?.destroy();
                    this.mesh = null;
                    await native?.stopCallAudio().catch(() => {});
                }
                throw error;
            })
            .finally(() => {
                if (this.mediaStarting === work) {
                    this.mediaStarting = null;
                }
            });
        this.mediaStarting = work;
        return work;
    }

    async recover() {
        if (this.disposed || !this.socket.connected) {
            return;
        }
        const generation = this.generation;
        const eventSequence = this.eventSequence;
        try {
            if (this.state.call?.context === 'party') {
                const roomId = this.state.call.roomId;
                await this.ack('room:enter', { roomId });
                if (generation !== this.generation) {
                    return;
                }
                this.mesh?.reconnect();
                this.beginMedia();
                return;
            }
            const result = await this.ack<{ state: DirectCallState | null }>('call:current');
            if (
                this.disposed ||
                generation !== this.generation ||
                eventSequence !== this.eventSequence
            ) {
                return;
            }
            if (result.state) {
                this.applyDirectState(result.state);
                if (result.state.status === 'in_call' && result.state.media?.active !== false) {
                    await this.ack('call:resume', {
                        roomId: result.state.roomId,
                        ...(result.state.media
                            ? { ownershipRevision: result.state.media.ownershipRevision }
                            : {}),
                    });
                    if (generation === this.generation) {
                        this.mesh?.reconnect();
                    }
                }
            } else {
                this.patch({ incoming: null, ongoingElsewhere: null });
                if (this.state.call?.context === 'direct') {
                    this.clearCall();
                }
            }
        } catch (error) {
            if (this.disposed || generation !== this.generation) {
                return;
            }
            if (this.state.call) {
                this.fail(errorText(error));
                clearTimeout(this.retryTimer);
                this.retryTimer = setTimeout(() => void this.recover(), 3000);
            }
        }
    }

    private persistPreferences() {
        this.preferenceRevision++;
        const { muted, masterVolume, participantVolumes } = this.state;
        this.preferenceWrite = this.preferenceWrite
            .catch(() => {})
            .then(() =>
                saveCallPreferences(this.userId, {
                    muted,
                    masterVolume,
                    participantVolumes,
                }),
            )
            .catch(() => {});
    }

    setMuted(muted: boolean) {
        this.patch({ muted });
        this.persistPreferences();
        this.mesh?.setMuted(muted || this.state.interrupted);
    }
    async setSpeaker(speaker: boolean) {
        try {
            await native?.setSpeakerphone(speaker);
            this.patch({ speaker });
        } catch (error) {
            this.fail(errorText(error));
        }
    }
    async getAudioRoutes(): Promise<AudioRoute[]> {
        if (!native?.getAudioRoutes) {
            return [];
        }
        if (Platform.OS === 'android' && Number(Platform.Version) >= 31) {
            const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
            if (await PermissionsAndroid.check(permission)) {
                this.patch({ bluetoothPermission: null });
            } else {
                const result = await PermissionsAndroid.request(permission);
                this.patch({
                    bluetoothPermission:
                        result === PermissionsAndroid.RESULTS.GRANTED
                            ? null
                            : result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
                            ? 'blocked'
                            : 'denied',
                });
            }
        }
        return native.getAudioRoutes();
    }
    async selectAudioRoute(route: AudioRoute) {
        if (!native?.selectAudioRoute) {
            return;
        }
        try {
            await native.selectAudioRoute(route.id);
            this.patch({ speaker: route.type === 'speaker' });
        } catch (error) {
            this.fail(errorText(error));
            throw error;
        }
    }
    setMasterVolume(value: number) {
        this.patch({ masterVolume: clampVolume(value) });
        this.persistPreferences();
        this.mesh?.applyVolumes();
    }
    setParticipantVolume(userId: number, value: number) {
        this.patch({
            participantVolumes: {
                ...this.state.participantVolumes,
                [userId]: clampVolume(value),
            },
        });
        this.persistPreferences();
        this.mesh?.applyVolumes();
    }
    setScreenVolume(value: number) {
        this.patch({
            screenVolume: clampVolume(value),
            screenAudioMuted: value === 0,
        });
        this.mesh?.applyVolumes();
    }
    setScreenAudioMuted(muted: boolean) {
        this.patch({ screenAudioMuted: muted });
        this.mesh?.applyVolumes();
    }

    private async stopSharedSystemAudio(message: string) {
        const stream = this.state.localScreen;
        if (!stream || !this.state.localSystemAudio) {
            return;
        }
        this.patch({ localSystemAudio: false });
        detachScreenAudio(stream);
        if (this.state.localScreen === stream) {
            await this.mesh?.setScreen(stream, this.screenLimits).catch(() => {});
            await this.mesh?.replaceMicrophoneTrack(null).catch(() => {});
            await this.releaseSystemAudio();
            this.fail(`Экран продолжает передаваться без звука приложений. ${message}`);
        }
    }

    async startScreenShare(withSystemAudio = false) {
        if (!this.mesh || !this.state.call || this.state.sharingBusy || this.state.localScreen) {
            return;
        }
        const generation = this.generation;
        const mesh = this.mesh;
        this.patch({ sharingBusy: true, error: null });
        let stream: MediaStream | null = null;
        try {
            await this.screenAudioCleanup;
            const display = Dimensions.get('screen');
            stream = await mediaDevices.getDisplayMedia({
                android: {
                    resolutionScale:
                        1 /
                        screenResolutionScale(
                            display.width * display.scale,
                            display.height * display.scale,
                            this.screenLimits.targetLongSide,
                        ),
                },
            });
            if (generation !== this.generation || this.disposed) {
                stream.getTracks().forEach((track) => track.stop());
                stream.release();
                return;
            }
            await this.configureScreen(stream);
            let localSystemAudio = false;
            if (withSystemAudio && this.canShareSystemAudio) {
                const video = stream.getVideoTracks()[0];
                try {
                    if (!video) {
                        throw new Error('Android не вернул видеопоток');
                    }
                    await native!.setAutomaticAudioRecording!(false);
                    if (generation !== this.generation || this.disposed) {
                        await this.releaseSystemAudio();
                        stream.getTracks().forEach((track) => track.stop());
                        stream.release();
                        return;
                    }
                    const info = await native!.startSystemAudioShare!(video.id);
                    const track = new MediaStreamTrack(info.screenInfo);
                    const microphone = new MediaStreamTrack(info.microphoneInfo);
                    if (generation !== this.generation || this.disposed) {
                        track.stop();
                        microphone.stop();
                        stream.getTracks().forEach((item) => item.stop());
                        stream.release();
                        await this.releaseSystemAudio();
                        return;
                    }
                    await mesh.replaceMicrophoneTrack(microphone);
                    stream.addTrack(track);
                    localSystemAudio = true;
                } catch (error) {
                    await mesh.replaceMicrophoneTrack(null).catch(() => {});
                    await this.releaseSystemAudio();
                    if (generation !== this.generation || this.disposed) {
                        stream.getTracks().forEach((item) => item.stop());
                        stream.release();
                        return;
                    }
                    this.fail('Экран передаётся без звука приложений. ' + errorText(error));
                }
            }
            if (generation !== this.generation || this.disposed) {
                await mesh.replaceMicrophoneTrack(null).catch(() => {});
                await this.releaseSystemAudio();
                stream.getTracks().forEach((track) => track.stop());
                stream.release();
                return;
            }
            this.patch({ localScreen: stream, localSystemAudio });
            stream.getVideoTracks().forEach((track) =>
                track.addEventListener('ended', () => {
                    if (generation === this.generation) {
                        void this.stopScreenShare();
                    }
                }),
            );
            await mesh.setScreen(stream, this.screenLimits);
        } catch (error) {
            await mesh.setScreen(null, this.screenLimits).catch(() => {});
            await mesh.replaceMicrophoneTrack(null).catch(() => {});
            detachScreenAudio(stream);
            await this.releaseSystemAudio();
            stream?.getTracks().forEach((track) => track.stop());
            stream?.release();
            this.patch({ localScreen: null, localSystemAudio: false });
            const text = errorText(error);
            if (!/cancel|denied|notallowed/i.test(text)) {
                this.fail('Не удалось начать демонстрацию. ' + text);
            }
        } finally {
            if (generation === this.generation) {
                this.patch({ sharingBusy: false });
            }
        }
    }

    async stopScreenShare() {
        const stream = this.state.localScreen;
        if (!stream) {
            return;
        }
        this.patch({
            localScreen: null,
            localSystemAudio: false,
            sharingBusy: true,
        });
        try {
            await this.mesh?.setScreen(null, this.screenLimits);
        } catch (error) {
            this.fail('Демонстрация остановлена. ' + errorText(error));
        } finally {
            await this.mesh?.replaceMicrophoneTrack(null).catch(() => {});
            detachScreenAudio(stream);
            await this.releaseSystemAudio();
            stream.getTracks().forEach((track) => track.stop());
            stream.release();
            this.patch({ sharingBusy: false });
        }
    }

    dispose() {
        if (this.disposed) {
            return;
        }
        this.end();
        this.disposed = true;
        this.syncRinging();
        clearInterval(this.heartbeat);
        clearInterval(this.poll);
        this.bindings.forEach((unbind) => unbind());
        this.subscriptions.forEach((subscription) => subscription.remove());
        this.iceWaiting.forEach((resolve) => resolve([]));
        this.iceWaiting.clear();
        this.listeners.clear();
    }
}
