const { randomUUID } = require('node:crypto');

function registerFixtureCalls({ socket, io, getState, findUser, friends }) {
    const uid = socket.data.userId;
    const user = () => getState().users.get(uid);
    const isParticipant = (call) => call && [call.caller.id, call.receiver.id].includes(uid);
    const emitCall = (event, data, call = getState().call) => {
        if (!call) {
            return;
        }
        io.to([String(call.caller.id), String(call.receiver.id)]).emit(event, data);
    };
    const end = (call, reason = 'call:ended') => {
        if (getState().call?.roomId !== call?.roomId) {
            return;
        }
        getState().call = null;
        emitCall(reason, { roomId: call.roomId }, call);
        if (reason !== 'call:ended') {
            emitCall('call:ended', { roomId: call.roomId }, call);
        }
    };

    socket.on('call:current', (ack) =>
        ack({ state: isParticipant(getState().call) ? getState().call : null }),
    );
    socket.on('call:start', (data, ack) => {
        const peer = findUser(data.username);
        if (!peer || peer.id === uid || !friends(uid, peer.id)) {
            return ack({ err: 'Можно звонить только друзьям' });
        }
        if (getState().call) {
            return ack({ err: 'Вы уже в другом звонке' });
        }
        const call = {
            roomId: `${uid}:${peer.id}:${randomUUID()}`,
            status: 'request_receiver',
            revision: 1,
            caller: { id: uid, username: user().username },
            receiver: { id: peer.id, username: peer.username },
            expiresAt: Date.now() + 60000,
        };
        getState().call = call;
        emitCall('call:state', call);
        io.to(String(peer.id)).emit('call:incomingCall', {
            from: user().username,
            roomId: call.roomId,
            expiresAt: call.expiresAt,
        });
        const timer = setTimeout(() => {
            if (
                getState().call?.roomId === call.roomId &&
                getState().call.status === 'request_receiver'
            ) {
                end(call, 'call:noAnswer');
            }
        }, 60000);
        timer.unref();
        ack({ success: true, roomId: call.roomId, confirmed: false, state: call });
    });
    socket.on('call:confirm', (data, ack) => {
        const call = getState().call;
        if (!call || call.roomId !== data.roomId) {
            return ack?.({ err: 'Звонок уже завершён' });
        }
        if (call.receiver.id !== uid) {
            return ack?.({ err: 'Только получатель может ответить на звонок' });
        }
        if (!data.accept) {
            end(call, 'call:rejected');
            return ack?.({ success: true, state: null });
        }
        call.status = 'in_call';
        call.revision = 2;
        emitCall('call:state', call);
        emitCall('call:confirmed', { roomId: call.roomId });
        ack?.({ success: true, state: call });
    });
    socket.on('call:end', (data, ack) => {
        const call = getState().call;
        if (isParticipant(call) && call.roomId === data.roomId) {
            end(call);
        }
        ack?.({ success: true });
    });
    socket.on('call:resume', (data, ack) => {
        const call = getState().call;
        if (!call || call.roomId !== data.roomId) {
            return ack({ ended: true });
        }
        if (!isParticipant(call)) {
            return ack({ err: 'You are not part of this call' });
        }
        ack({ success: true, status: call.status });
    });
    socket.on('call:heartbeat', (data) => {
        if (getState().call?.roomId !== data.roomId) {
            socket.emit('call:ended', { roomId: data.roomId });
        }
    });
    socket.on('webrtc:config:request', () => {
        const iceServers =
            process.env.PLAYTIME_TEST_TURN === '1'
                ? [
                      {
                          urls: `turn:${uid === 1 ? '10.0.2.2' : '127.0.0.1'}:3478?transport=tcp`,
                          username: 'playtime-e2e',
                          credential: 'local-e2e-only',
                      },
                  ]
                : [];
        socket.emit('webrtc:config', { iceServers });
    });
    const signalAllowed = async (data) => {
        if (data.context === 'direct') {
            const call = getState().call;
            return isParticipant(call) && call.roomId === data.roomId && call.status === 'in_call';
        }
        if (data.context !== 'party') {
            return false;
        }
        return socket.rooms.has(`voice:${data.roomId}`);
    };
    socket.on('webrtc:signal', async (data) => {
        if (!(await signalAllowed(data))) {
            return;
        }
        if (
            data.context === 'direct' &&
            ![getState().call.caller.id, getState().call.receiver.id].includes(data.targetUserId)
        ) {
            return;
        }
        io.to(String(data.targetUserId)).emit('webrtc:signal', {
            ...data,
            fromUserId: uid,
            fromUsername: user().username,
        });
    });
    socket.on('webrtc:screen:state', async (data) => {
        if (!(await signalAllowed(data))) {
            return;
        }
        const message = { ...data, fromUserId: uid, fromUsername: user().username };
        if (data.context === 'party') {
            socket.to(`voice:${data.roomId}`).emit('webrtc:screen:state', message);
        } else {
            emitCall('webrtc:screen:state', message);
        }
    });
    socket.on('room:enter', async (data, ack) => {
        const room = getState().rooms.get(data.roomId);
        if (!room?.members.some((member) => member.id === uid)) {
            return ack({ err: 'Нет доступа' });
        }
        const roomName = `voice:${data.roomId}`;
        const alreadyJoined = socket.rooms.has(roomName);
        await socket.join(roomName);
        const members = await io.in(roomName).fetchSockets();
        const participants = [
            ...new Map(
                members.map((member) => {
                    const profile = getState().users.get(member.data.userId);
                    return [profile.id, { userId: profile.id, username: profile.username }];
                }),
            ).values(),
        ];
        socket.emit('party:participants:list', participants);
        if (!alreadyJoined) {
            socket
                .to(roomName)
                .emit('party:participant:joined', { userId: uid, username: user().username });
        }
        ack({ success: true });
    });
    socket.on('room:leave', async (data) => {
        const roomName = `voice:${data.roomId}`;
        if (!socket.rooms.has(roomName)) {
            return;
        }
        await socket.leave(roomName);
        socket
            .to(roomName)
            .emit('party:participant:left', { userId: uid, username: user().username });
    });
    socket.on('disconnecting', () => {
        for (const roomName of socket.rooms) {
            if (roomName.startsWith('voice:')) {
                socket.to(roomName).emit('party:participant:left', {
                    userId: uid,
                    username: user()?.username ?? 'Участник',
                });
            }
        }
    });
}

module.exports = { registerFixtureCalls };
