window.startPlaytimePeer = async function startPlaytimePeer({
    base,
    token,
    user,
    autoAnswer,
    control,
    desktopMesh: useDesktopMesh,
    useTurn,
}) {
    const iceServers = useTurn
        ? [
              {
                  urls: 'turn:127.0.0.1:3478?transport=tcp',
                  username: 'playtime-e2e',
                  credential: 'local-e2e-only',
              },
          ]
        : [];
    if (useTurn) {
        const BrowserPeerConnection = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends BrowserPeerConnection {
            constructor(configuration) {
                super({ ...configuration, iceTransportPolicy: 'relay' });
            }
        };
    }
    const socket = io(base, {
        path: '/playtime/socket.io',
        auth: { token, callProtocol: 2 },
        transports: ['websocket'],
    });
    const audio = new AudioContext({ sampleRate: 48000 });
    await audio.resume();
    const voiceDestination = audio.createMediaStreamDestination();
    const oscillator = audio.createOscillator();
    oscillator.frequency.value = 440;
    const gain = audio.createGain();
    gain.gain.value = 0.06;
    oscillator.connect(gain).connect(voiceDestination);
    oscillator.start();
    const peers = new Map();
    const errors = [];
    const events = [];
    let currentCall = null;
    let incoming = null;
    let screen = null;
    let screenAudio = null;
    let screenAnimation;
    let muted = false;
    let desktopMesh = null;
    const log = (event, data) => {
        events.push({ event, data, at: Date.now() });
        if (events.length > 80) {
            events.shift();
        }
    };
    const fail = (error) => {
        errors.push(String(error?.message ?? error));
        if (errors.length > 20) {
            errors.shift();
        }
    };
    const mapCandidate = async (candidate) => {
        const response = await fetch(`${control}/ice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(candidate),
        });
        return response.json();
    };
    if (useDesktopMesh) {
        navigator.mediaDevices.getUserMedia = async () => voiceDestination.stream.clone();
        const emit = socket.emit.bind(socket);
        socket.emit = (event, ...args) => {
            const data = args[0];
            if (
                event === 'webrtc:signal' &&
                data?.type === 'ice' &&
                data.targetUserId === 1 &&
                !useTurn
            ) {
                void mapCandidate(data.payload)
                    .then((payload) => {
                        emit(event, { ...data, payload });
                    })
                    .catch(fail);
                return socket;
            }
            return emit(event, ...args);
        };
    }
    const ensureDesktopMesh = () => {
        if (!desktopMesh && currentCall) {
            desktopMesh = new window.PlayTimeDesktop.VoiceMesh({
                socket,
                roomId: currentCall.roomId,
                context: currentCall.context,
                myUserId: user.id,
                iceServers,
                directCallerId: currentCall.caller?.id,
            });
            void desktopMesh.start().catch(fail);
            desktopMesh.onScreenShare(({ userId, stream }) => showRemoteScreen(userId, stream));
        }
        return desktopMesh;
    };
    const ack = (event, data) =>
        new Promise((resolve, reject) => {
            const callback = (error, result) =>
                error || result?.err
                    ? reject(new Error(error?.message ?? result.err))
                    : resolve(result);
            if (data === undefined) {
                socket.timeout(8000).emit(event, callback);
            } else {
                socket.timeout(8000).emit(event, data, callback);
            }
        });
    const signal = (id, type, payload) => {
        if (currentCall && socket.connected) {
            socket.emit('webrtc:signal', {
                roomId: currentCall.roomId,
                context: currentCall.context,
                targetUserId: id,
                type,
                payload,
            });
        }
    };
    const showRemoteScreen = (id, stream) => {
        const existing = document.getElementById(`remote-screen-${id}`);
        if (!stream) {
            existing?.remove();
            return;
        }
        const video = existing ?? document.createElement('video');
        video.id = `remote-screen-${id}`;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        if (video.srcObject !== stream) {
            video.srcObject = stream;
        }
        if (!existing) {
            document.getElementById('received-screens').appendChild(video);
        }
        void video.play().catch((error) => {
            if (error.name !== 'AbortError') {
                fail(error);
            }
        });
    };
    const enqueue = (peer, action) => {
        const work = peer.tail.then(async () => {
            if (peers.get(peer.id) === peer && peer.pc.signalingState !== 'closed') {
                await action();
            }
        });
        peer.tail = work.catch(fail);
        return work;
    };
    const offer = (peer, restart = false) =>
        enqueue(peer, async () => {
            if (peer.pc.signalingState !== 'stable') {
                peer.needsOffer = true;
                return;
            }
            const description = await peer.pc.createOffer(restart ? { iceRestart: true } : {});
            await peer.pc.setLocalDescription(description);
            if (peers.get(peer.id) === peer) {
                signal(peer.id, 'offer', description);
            }
        });
    const getPeer = (id) => {
        if (peers.has(id)) {
            return peers.get(id);
        }
        const pc = new RTCPeerConnection({ iceServers });
        const peer = {
            id,
            pc,
            tail: Promise.resolve(),
            pendingIce: [],
            ignored: false,
            needsOffer: false,
            screenSenders: [],
            audioTracks: [],
            videoTracks: [],
            analysedStreams: new Map(),
        };
        peers.set(id, peer);
        voiceDestination.stream
            .getTracks()
            .forEach((track) => pc.addTrack(track, voiceDestination.stream));
        if (screen) {
            screen
                .getTracks()
                .forEach((track) => peer.screenSenders.push(pc.addTrack(track, screen)));
        }
        pc.onicecandidate = (event) => {
            if (event.candidate && peers.get(id) === peer) {
                const original = event.candidate.toJSON();
                if (id !== 1 || useTurn) {
                    signal(id, 'ice', original);
                    return;
                }
                void mapCandidate(original)
                    .then((candidate) => {
                        if (peers.get(id) === peer) {
                            log('mapped-ice', candidate.candidate);
                            signal(id, 'ice', candidate);
                        }
                    })
                    .catch(fail);
            }
        };
        pc.ontrack = (event) => {
            if (event.track.kind === 'audio') {
                peer.audioTracks.push(event.track.id);
                peer.remoteAudio = event.streams[0] ?? new MediaStream([event.track]);
            } else {
                peer.videoTracks.push(event.track.id);
            }
            const stream = event.streams[0];
            if (stream?.getVideoTracks().length) {
                showRemoteScreen(id, stream);
            }
            if (stream?.getAudioTracks().length && !peer.analysedStreams.has(stream.id)) {
                const source = audio.createMediaStreamSource(stream);
                const analyser = audio.createAnalyser();
                analyser.fftSize = 4096;
                analyser.smoothingTimeConstant = 0;
                const silent = audio.createGain();
                silent.gain.value = 0;
                source.connect(analyser).connect(silent).connect(audio.destination);
                peer.analysedStreams.set(stream.id, { stream, source, analyser, silent });
            }
            log('track', { id, kind: event.track.kind });
        };
        pc.onconnectionstatechange = () => log('connection', { id, state: pc.connectionState });
        pc.onsignalingstatechange = () => {
            if (pc.signalingState === 'stable' && peer.needsOffer) {
                peer.needsOffer = false;
                void offer(peer).catch(fail);
            }
        };
        return peer;
    };
    const clear = () => {
        if (desktopMesh) {
            void desktopMesh.destroy().catch(fail);
            desktopMesh = null;
        }
        peers.forEach((peer) => {
            peer.pc.close();
            peer.analysedStreams.forEach(({ source, analyser, silent }) => {
                source.disconnect();
                analyser.disconnect();
                silent.disconnect();
            });
        });
        peers.clear();
        document.getElementById('received-screens').replaceChildren();
        currentCall = null;
        incoming = null;
        screen?.getTracks().forEach((track) => track.stop());
        screen = null;
        screenAudio?.stop();
        screenAudio = null;
        cancelAnimationFrame(screenAnimation);
    };
    const applyState = (state) => {
        if (!state || ![state.caller.id, state.receiver.id].includes(user.id)) {
            return;
        }
        log('call:state', { roomId: state.roomId, status: state.status });
        if (state.status === 'request_receiver' && state.receiver.id === user.id) {
            incoming = state;
            if (autoAnswer) {
                void ack('call:confirm', { roomId: state.roomId, accept: true }).catch(fail);
            }
            return;
        }
        const fresh = currentCall?.roomId !== state.roomId;
        if (currentCall && fresh) {
            clear();
        }
        currentCall = { ...state, context: 'direct' };
        incoming = null;
        if (useDesktopMesh) {
            if (state.status === 'in_call') {
                void ensureDesktopMesh().startDirectCall().catch(fail);
            }
            return;
        }
        if (
            state.status === 'in_call' &&
            user.id === state.caller.id &&
            (fresh || peers.size === 0)
        ) {
            void offer(getPeer(state.receiver.id)).catch(fail);
        }
    };
    socket.on('call:state', applyState);
    socket.on('call:ended', (data) => {
        if (data.roomId === currentCall?.roomId || data.roomId === incoming?.roomId) {
            clear();
        }
    });
    socket.on('webrtc:signal', (message) => {
        if (useDesktopMesh) {
            return;
        }
        if (
            !currentCall ||
            message.context !== currentCall.context ||
            String(message.roomId) !== String(currentCall.roomId)
        ) {
            return;
        }
        const peer = getPeer(message.fromUserId);
        void enqueue(peer, async () => {
            if (message.type === 'ice') {
                if (peer.ignored) {
                    return;
                }
                if (!peer.pc.remoteDescription) {
                    peer.pendingIce.push(message.payload);
                    return;
                }
                try {
                    await peer.pc.addIceCandidate(message.payload);
                } catch {
                }
                return;
            }
            if (message.type === 'offer') {
                const collision = peer.pc.signalingState !== 'stable';
                peer.ignored = user.id > message.fromUserId && collision;
                if (peer.ignored) {
                    return;
                }
                if (collision) {
                    await peer.pc.setLocalDescription({ type: 'rollback' });
                }
                await peer.pc.setRemoteDescription(message.payload);
                for (const candidate of peer.pendingIce.splice(0)) {
                    await peer.pc.addIceCandidate(candidate);
                }
                const answer = await peer.pc.createAnswer();
                await peer.pc.setLocalDescription(answer);
                if (peers.get(peer.id) === peer) {
                    signal(peer.id, 'answer', answer);
                }
            } else if (message.type === 'answer' && peer.pc.signalingState === 'have-local-offer') {
                await peer.pc.setRemoteDescription(message.payload);
                peer.ignored = false;
                for (const candidate of peer.pendingIce.splice(0)) {
                    await peer.pc.addIceCandidate(candidate);
                }
            }
        }).catch(fail);
    });
    socket.on('party:participants:list', (list) => {
        if (currentCall?.context !== 'party') {
            return;
        }
        currentCall.participants = list;
        if (useDesktopMesh) {
            void ensureDesktopMesh().connectPartyPeers(list).catch(fail);
            return;
        }
        for (const participant of list) {
            if (user.id < participant.userId) {
                void offer(getPeer(participant.userId)).catch(fail);
            }
        }
    });
    socket.on('party:participant:joined', (participant) => {
        if (currentCall?.context === 'party' && participant.userId !== user.id) {
            if (useDesktopMesh) {
                void ensureDesktopMesh().onPartyPeerJoined(participant).catch(fail);
                return;
            }
            void offer(getPeer(participant.userId)).catch(fail);
        }
    });
    socket.on('party:participant:left', (participant) => {
        if (useDesktopMesh) {
            desktopMesh?.onPartyPeerLeft(participant.userId);
            return;
        }
        peers.get(participant.userId)?.pc.close();
        peers.delete(participant.userId);
    });
    socket.on('connect', () => {
        log('connect', { id: socket.id });
        if (currentCall?.context === 'party') {
            void ack('room:enter', { roomId: currentCall.roomId }).catch(fail);
        } else {
            void ack('call:current')
                .then((result) => {
                    if (result.state) {
                        applyState(result.state);
                    }
                })
                .catch(fail);
        }
    });
    socket.on('connect_error', fail);
    const share = async ({ enabled = true } = {}) => {
        if (!currentCall) {
            throw new Error('No active call');
        }
        if (!enabled) {
            screen?.getTracks().forEach((track) => track.stop());
            screenAudio?.stop();
            screenAudio = null;
            screen = null;
            cancelAnimationFrame(screenAnimation);
        } else if (!screen) {
            const canvas = document.getElementById('screen');
            const context = canvas.getContext('2d');
            const paint = () => {
                context.fillStyle = '#142B3D';
                context.fillRect(0, 0, 640, 360);
                context.fillStyle = '#3AA8FF';
                context.beginPath();
                context.arc(110 + Math.sin(Date.now() / 550) * 45, 160, 62, 0, Math.PI * 2);
                context.fill();
                context.fillStyle = '#FDFDFD';
                context.font = 'bold 38px sans-serif';
                context.fillText('PlayTime', 230, 153);
                context.font = '22px sans-serif';
                context.fillText('Desktop → Android', 230, 195);
                context.fillStyle = '#2EE7FF';
                context.font = '16px monospace';
                context.fillText(new Date().toISOString().slice(11, 23), 230, 245);
                screenAnimation = requestAnimationFrame(paint);
            };
            paint();
            screen = canvas.captureStream(12);
            const destination = audio.createMediaStreamDestination();
            screenAudio = audio.createOscillator();
            screenAudio.frequency.value = 660;
            const screenGain = audio.createGain();
            screenGain.gain.value = 0.04;
            screenAudio.connect(screenGain).connect(destination);
            screenAudio.start();
            destination.stream.getAudioTracks().forEach((track) => screen.addTrack(track));
        }
        if (useDesktopMesh) {
            await ensureDesktopMesh().setScreenShare(screen);
        }
        for (const peer of peers.values()) {
            peer.screenSenders.forEach((sender) => peer.pc.removeTrack(sender));
            peer.screenSenders = [];
            if (screen) {
                screen
                    .getTracks()
                    .forEach((track) => peer.screenSenders.push(peer.pc.addTrack(track, screen)));
            }
            await offer(peer);
        }
        socket.emit('webrtc:screen:state', {
            roomId: currentCall.roomId,
            context: currentCall.context,
            active: !!screen,
        });
        return { sharing: !!screen };
    };
    const status = async () => {
        const connections = [];
        const activePeers = desktopMesh
            ? [...desktopMesh.peers.entries()].map(([id, peer]) => ({
                  id,
                  pc: peer.pc,
                  audioTracks: peer.pc
                      .getReceivers()
                      .filter((receiver) => receiver.track?.kind === 'audio'),
                  videoTracks: peer.pc
                      .getReceivers()
                      .filter((receiver) => receiver.track?.kind === 'video'),
                  analysedStreams: new Map(),
              }))
            : [...peers.values()];
        for (const peer of activePeers) {
            const stats = await peer.pc.getStats();
            const media = [];
            const candidates = [];
            const audioSignals = [];
            peer.analysedStreams.forEach(({ stream, analyser }) => {
                const frequencies = new Float32Array(analyser.frequencyBinCount);
                const waveform = new Float32Array(analyser.fftSize);
                analyser.getFloatFrequencyData(frequencies);
                analyser.getFloatTimeDomainData(waveform);
                let peak = 0;
                for (let index = 1; index < frequencies.length; index++) {
                    if (frequencies[index] > frequencies[peak]) {
                        peak = index;
                    }
                }
                audioSignals.push({
                    streamId: stream.id,
                    screen: stream.getVideoTracks().length > 0,
                    peakHz: Math.round((peak * audio.sampleRate) / analyser.fftSize),
                    rms: Math.sqrt(
                        waveform.reduce((sum, value) => sum + value * value, 0) / waveform.length,
                    ),
                });
            });
            stats.forEach((report) => {
                if (
                    ['local-candidate', 'remote-candidate', 'candidate-pair'].includes(report.type)
                ) {
                    candidates.push({
                        type: report.type,
                        id: report.id,
                        address: report.address,
                        port: report.port,
                        protocol: report.protocol,
                        candidateType: report.candidateType,
                        localCandidateId: report.localCandidateId,
                        remoteCandidateId: report.remoteCandidateId,
                        state: report.state,
                        nominated: report.nominated,
                    });
                }
                if (['inbound-rtp', 'outbound-rtp'].includes(report.type)) {
                    media.push({
                        type: report.type,
                        kind: report.kind,
                        bytesReceived: report.bytesReceived,
                        bytesSent: report.bytesSent,
                        packetsReceived: report.packetsReceived,
                        packetsSent: report.packetsSent,
                        framesDecoded: report.framesDecoded,
                        frameWidth: report.frameWidth,
                        frameHeight: report.frameHeight,
                        framesPerSecond: report.framesPerSecond,
                        totalAudioEnergy: report.totalAudioEnergy,
                    });
                }
            });
            connections.push({
                id: peer.id,
                connection: peer.pc.connectionState,
                signaling: peer.pc.signalingState,
                audioTracks: peer.audioTracks.length,
                videoTracks: peer.videoTracks.length,
                media,
                candidates,
                audioSignals,
            });
        }
        return {
            implementation: useDesktopMesh ? 'apps/frontend/src/webrtc/voiceMesh.ts' : 'reference WebRTC fixture',
            transport: useTurn ? iceServers[0].urls : 'emulator UDP bridge',
            username: user.username,
            userId: user.id,
            connected: socket.connected,
            call: currentCall
                ? {
                      roomId: currentCall.roomId,
                      context: currentCall.context,
                      status: currentCall.status,
                  }
                : null,
            incoming: !!incoming,
            sharing: !!screen,
            muted,
            connections,
            errors,
            events,
        };
    };
    window.playtimePeer = {
        status,
        async call({ username: target = 'Mika' } = {}) {
            const result = await ack('call:start', { username: target });
            if (result.state) {
                applyState(result.state);
            }
            return { success: true };
        },
        async hangup() {
            if (currentCall) {
                socket.emit(currentCall.context === 'party' ? 'room:leave' : 'call:end', {
                    roomId: currentCall.roomId,
                });
            }
            clear();
            return { success: true };
        },
        share,
        mute({ enabled = true } = {}) {
            muted = enabled;
            desktopMesh?.setMicEnabled(!muted);
            voiceDestination.stream.getAudioTracks().forEach((track) => {
                track.enabled = !muted;
            });
            return { muted };
        },
        async reconnect() {
            socket.disconnect();
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Peer reconnect timed out')), 8000);
                socket.once('connect', () => {
                    clearTimeout(timer);
                    resolve();
                });
                socket.connect();
            });
            desktopMesh?.reconnect();
            for (const peer of peers.values()) {
                await offer(peer, true);
            }
            return { success: true };
        },
        async joinParty({ roomId = 10 } = {}) {
            if (currentCall) {
                throw new Error('End the current call first');
            }
            currentCall = { roomId, context: 'party', status: 'in_call' };
            await ack('room:enter', { roomId });
            return { success: true };
        },
        async leaveParty() {
            return this.hangup();
        },
        async accept() {
            if (!incoming) {
                throw new Error('No incoming call');
            }
            return ack('call:confirm', { roomId: incoming.roomId, accept: true });
        },
        async reject() {
            if (!incoming) {
                throw new Error('No incoming call');
            }
            return ack('call:confirm', { roomId: incoming.roomId, accept: false });
        },
    };
    setInterval(() => {
        void status().then((result) => {
            document.getElementById('status').textContent = JSON.stringify(result, null, 2);
        });
    }, 1500);
    return { ready: true };
};
