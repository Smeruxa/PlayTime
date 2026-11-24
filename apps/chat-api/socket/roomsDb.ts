import type { FeatureContext } from "../../shared/socket/featureContext"
import { registerRoomInvites } from "./rooms/invites"
import { registerRoomMembership } from "./rooms/membership"
import { registerRoomOwnership } from "./rooms/ownership"
import { registerRoomRecords } from "./rooms/records"
import { registerRoomViews } from "./rooms/views"

export type {
    RoomAddMemberPayload,
    RoomCreatePayload,
    RoomIdPayload,
    RoomRemoveMemberPayload,
    RoomRenamePayload
} from "./rooms/contracts"

export default function registerPartyRoomsDb(context: FeatureContext): void {
    registerRoomRecords(context)
    registerRoomViews(context)
    registerRoomMembership(context)
    registerRoomInvites(context)
    registerRoomOwnership(context)
}
