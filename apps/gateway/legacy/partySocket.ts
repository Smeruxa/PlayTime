import type { FeatureContext } from "../../shared/socket/featureContext"
import registerPartyRoomsDb from "../../chat-api/socket/roomsDb"
import registerPartyRoomsSocket from "../../room-api/socket/party/roomsSocket"
import registerPartyMedia from "../../room-api/socket/party/partyMedia"
import { localPartyServices } from "./partyServices"

export default function registerParty(ctx: FeatureContext): void {
    registerPartyRoomsDb(ctx)
    registerPartyRoomsSocket(ctx, localPartyServices)
    registerPartyMedia(ctx, localPartyServices.limits)
}
