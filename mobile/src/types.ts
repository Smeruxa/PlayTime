export type Session = {
    token: string;
    refreshToken: string;
    expiresIn: number;
    user: { id: number; username: string; email: string };
};

export type ChatRef = {
    id: number;
    name: string;
    isRoom: boolean;
    createdBy?: number;
    archived?: boolean;
};
export type Friend = {
    id: number;
    user_id: number;
    friend_id: number;
    friend_username: string;
    friend_archived?: boolean;
    status: 'accepted' | 'pending' | 'blocked';
    direction?: 'incoming' | 'outgoing';
    is_room?: boolean;
};
export type Room = { id: number; name: string; created_by: number };
export type RoomMember = { id: number; username: string; role: 'member' | 'moderator' };
export type RoomDetail = Room & { myId: number; members: RoomMember[] };
export type Profile = {
    userId?: number;
    archived?: boolean;
    username: string;
    email?: string;
    status: string;
    bio: string;
    avatar: string | null;
    profileBanner: string | null;
    profileAvatarEffect: string;
    profileBannerEffect: string;
    profileBannerSticker: string;
    createdAt: string;
    isSelf: boolean;
    dmPublicKey?: string | null;
};
export type ProfilePatch = Partial<
    Pick<
        Profile,
        | 'status'
        | 'bio'
        | 'avatar'
        | 'profileBanner'
        | 'profileAvatarEffect'
        | 'profileBannerEffect'
        | 'profileBannerSticker'
    >
>;
export type MediaDescriptor = {
    kind: 'voice' | 'attachment';
    storageKey: string;
    key: string;
    nonce: string;
    mime: string;
    filename: string;
    sizeBytes: number;
    durationSec?: number;
};
export type Message = {
    id: number;
    me: boolean;
    text: string;
    data: number;
    from: string;
    read: boolean;
    reply?: { id: number; author: string; preview: string } | null;
    editedAt?: number | null;
    reactions: { emoji: string; users: string[] }[];
    media?: MediaDescriptor;
    voice?: { key: string; durationSec: number; media?: MediaDescriptor };
    attachment?: {
        key: string;
        mime: string;
        filename: string;
        sizeBytes: number;
        media?: MediaDescriptor;
    };
    isThreadOp?: boolean;
    encrypted?: boolean;
    decryptError?: boolean;
};
export type Wallpaper =
    | { kind: 'none' }
    | { kind: 'preset'; id: string }
    | { kind: 'image'; dataUrl: string; dim: number; blur: number };
export type PlanLimits = {
    maxRoomMembers: number;
    maxPartySockets: number;
    maxVoiceMessageSec: number;
    maxScreenBroadcastFps: number;
    maxAttachmentBytes: number;
    screenShare: {
        targetLongSide: number;
        jpegQuality: number;
        remoteUiFps: number;
        captureIntervalMs: number;
    };
    profileBannerAllowed: boolean;
    profileBannerEffectsAllowed: boolean;
    avatarEffectsAllowed: boolean;
    profileAvatarEffectIds?: readonly string[];
    profileBannerEffectIds?: readonly string[];
    userSummary: string;
    displayName: string;
};
export type Subscription = { planSlug: string; limits: PlanLimits };
export type DeviceSession = {
    id: string;
    deviceName: string;
    createdAt: string;
    lastSeenAt: string;
    current: boolean;
};
export type RevocationChallenge = {
    challengeId: string;
    email: string;
    expiresAt: string;
    retryAfter: number;
};
export type Preview = { text: string; date: number; unread: number; me?: boolean };
export type EncryptionState = {
    ready: boolean;
    needsRecovery: boolean;
    error: string | null;
    changedPeer?: { peerUserId?: number; username: string; previous: string; key: string };
};
export type ClientSnapshot = {
    session: Session | null;
    bootstrapping: boolean;
    connection: 'offline' | 'connecting' | 'online';
    friends: Friend[];
    incoming: Friend[];
    outgoing: string[];
    outgoingPeers?: Friend[];
    rooms: Room[];
    online: string[];
    avatars: Record<string, { avatar: string | null; profileAvatarEffect: string }>;
    profile: Profile | null;
    subscription: Subscription | null;
    previews: Record<string, Preview>;
    currentChat: ChatRef | null;
    messages: Message[];
    historyLoading: boolean;
    hasMore: boolean;
    pinnedMessageId: number | null;
    roomReadWatermark: number;
    typingUsers: string[];
    wallpaper: Wallpaper;
    encryption: EncryptionState;
    error: string | null;
};

export type SendMessageOptions = {
    replyToId?: number | null;
    clientMessageId?: string;
    media?: MediaDescriptor;
};
export type FriendAction = 'request' | 'accept' | 'decline' | 'remove' | 'block';
export type LocalMedia = {
    uri: string;
    name: string;
    mime: string;
    size: number;
    base64?: string;
    durationSec?: number;
};
