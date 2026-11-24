import { arePeersBlocked, type PeerBlockEffects } from "../../chat-api/services/peerBlock"
import { endBlockedPeerCall } from "../../room-api/socket/directCall/endBlockedPeerCall"
import type { FeatureIo } from "../../shared/socket/featureContext"
import { invalidatePresenceFriends } from "../presence"

export function createLegacyPeerBlockEffects(io: () => Pick<FeatureIo, "to"> | undefined): PeerBlockEffects {
    return {
        friendsChanged: invalidatePresenceFriends,
        endCall: (command) => endBlockedPeerCall(command, arePeersBlocked, io())
    }
}
