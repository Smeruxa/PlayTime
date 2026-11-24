import type { PoolClient } from "pg"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import type { MessageSendPayload } from "./contracts"

export type MessageSendDatabase = Pick<PoolClient, "query">

export interface MessageToSend {
    db: MessageSendDatabase
    user: FeatureContext["user"]
    data: MessageSendPayload
    content: string
    replyToId: number | null
}

export interface SavedMessage {
    id: number
    deliver(context: Pick<FeatureContext, "io" | "socket">): Promise<void>
}
