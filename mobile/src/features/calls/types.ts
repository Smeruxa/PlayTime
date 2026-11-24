import type { MediaStream } from 'react-native-webrtc';

export type CallContext = 'direct' | 'party';
export type IceServer = { urls: string | string[]; username?: string; credential?: string };
export type Signal = {
    roomId: string | number;
    context: CallContext;
    fromUserId: number;
    fromUsername?: string;
    type: 'offer' | 'answer' | 'ice';
    fromOwnershipRevision?: number;
    targetOwnershipRevision?: number;
    payload: {
        type?: 'offer' | 'answer';
        sdp?: string;
        candidate?: string;
        sdpMid?: string | null;
        sdpMLineIndex?: number | null;
    };
};
export type CallParticipant = { userId: number; username: string; ownershipRevision?: number };
export type DirectCallMedia = Readonly<{
    active: boolean;
    canClaim: boolean;
    ownershipRevision: number;
}>;
export type DirectCallState = {
    roomId: string;
    status: 'request_receiver' | 'in_call';
    revision: number;
    caller: { id: number; username: string; ownershipRevision?: number };
    receiver: { id: number; username: string; ownershipRevision?: number };
    expiresAt?: number;
    media?: DirectCallMedia;
};
export type ActiveCall = {
    roomId: string | number;
    context: CallContext;
    title: string;
    phase: 'ringing' | 'connecting' | 'connected' | 'reconnecting';
    incoming: boolean;
    participants: CallParticipant[];
    startedAt?: number;
    expiresAt?: number;
    ownershipRevision?: number;
};
export type IncomingCall = {
    roomId: string;
    from: string;
    fromUserId?: number;
    expiresAt?: number;
};
export type CallScreenStream = { userId: number; username: string; stream: MediaStream };
export type CallSnapshot = {
    call: ActiveCall | null;
    ongoingElsewhere: DirectCallState | null;
    incoming: IncomingCall | null;
    busy: boolean;
    sharingBusy: boolean;
    muted: boolean;
    speaker: boolean;
    interrupted: boolean;
    permissionBlocked: boolean;
    bluetoothPermission: 'denied' | 'blocked' | null;
    error: string | null;
    localScreen: MediaStream | null;
    localSystemAudio: boolean;
    remoteScreens: CallScreenStream[];
    screenAudioMuted: boolean;
    screenVolume: number;
    masterVolume: number;
    participantVolumes: Record<number, number>;
    rttMs: number | null;
    needsResume: boolean;
};

export type AudioRoute = { id: string; name: string; type: string };
export type CallAvatarMap = Record<
    string,
    { avatar?: string | null; profileAvatarEffect?: string | null }
>;
