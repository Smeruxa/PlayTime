import type { FeatureContext } from "../../../shared/socket/featureContext"
import registerMessageSend from "./send"
import registerMessagePreviews from "./previews"
import registerMessageReadReceipts from "./readReceipts"
import registerMessageRoomReaders from "./roomReaders"
import registerMessageDelete from "./delete"
import registerMessageHistory from "./history"
import registerMessageEdit from "./edit"
import registerMessageReactions from "./reactions"
import registerChatTyping from "./typing"
import registerRoomE2eeKeys from "./roomE2eeKeys"
import registerRoomPin from "./pin"
import registerDmWallpaper from "./dmWallpaper"

export default function registerMessages(ctx: FeatureContext): void {
    registerRoomE2eeKeys(ctx)
    registerDmWallpaper(ctx)
    registerMessageSend(ctx)
    registerMessagePreviews(ctx)
    registerMessageReadReceipts(ctx)
    registerMessageRoomReaders(ctx)
    registerMessageDelete(ctx)
    registerMessageEdit(ctx)
    registerMessageReactions(ctx)
    registerChatTyping(ctx)
    registerRoomPin(ctx)
    registerMessageHistory(ctx)
}
