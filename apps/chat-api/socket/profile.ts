import type { FeatureContext } from "../../shared/socket/featureContext"
import { registerFriendAvatars } from "./profile/acceptedContacts"
import { registerPublicProfile } from "./profile/publicProfile"
import { registerDmPublicKeys } from "./profile/publicKeys"
import { registerProfileUpdate } from "./profile/update"

export type {
    FriendAvatarWire,
    FriendsAvatarsAck,
    ProfileGetAck,
    ProfileGetDmPublicKeyAck,
    ProfileGetDmPublicKeyPayload,
    ProfileGetPayload,
    ProfilePublicView,
    ProfileSetDmPublicKeyAck,
    ProfileSetDmPublicKeyPayload,
    ProfileUpdateAck,
    ProfileUpdatePayload
} from "./profile/contracts"

export default function registerProfile(ctx: FeatureContext): void {
    registerPublicProfile(ctx)
    registerProfileUpdate(ctx)
    registerFriendAvatars(ctx)
    registerDmPublicKeys(ctx)
}
