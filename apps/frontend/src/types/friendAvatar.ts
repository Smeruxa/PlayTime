export type FriendAvatarWire = {
    avatar: string | null
    profileAvatarEffect: string
}

export type FriendsAvatarsMap = Record<string, FriendAvatarWire>
