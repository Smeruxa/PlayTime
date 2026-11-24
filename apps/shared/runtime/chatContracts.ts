import type { IncomingCallPush } from "../types/contracts/directCall"
import type { RoomVoiceLimits } from "../types/contracts/partyRoom"
import { configuredServiceUrl, gatewayCredential, gatewayCredentialHeader, internalJson } from "./internalHttp"

export const chatPath = "/internal/chat"

export type ChatPeer = { id: number; username: string }

export type ChatReport = {
    id: string
    reporter: string | null
    reported: string | null
    reason: string
    created_at: string
    resolved_at: string | null
}

export const latestReportCursor = "9223372036854775807"
export const isReportId = (value: unknown): value is string => typeof value === "string" && /^\d{1,18}$/.test(value)

export type CallHistoryEntry = {
    roomId: string
    beginerId: number
    receiverId: number
    confirmedAt: number
    endedAt: number
    instanceId?: string
}

type User = { userId: number }
type Room = { roomId: number }
type PeerPair = User & { peerId: number }
type PeerSelector = { peerUserId: number; username?: never } | { username: string; peerUserId?: never }
type VoiceLimitSelector = (User & { roomId?: never }) | (Room & { userId?: never })
type EmptyResponse = Record<string, never>

type ChatRoutes = {
    peer: [PeerSelector, { peer: ChatPeer | null }]
    users: [{ userIds: number[] }, { users: ChatPeer[] }]
    audience: [{ recipientId: number; participantIds: number[] }, { room: string }]
    relationship: [PeerPair, { canCall: boolean; blocked: boolean }]
    "presence-friends": [User, { friends: ChatPeer[] }]
    membership: [Room & User, { member: boolean }]
    limits: [VoiceLimitSelector, { limits: RoomVoiceLimits | null }]
    "call-log": [CallHistoryEntry, EmptyResponse]
    "call-push": [IncomingCallPush, EmptyResponse]
    "reports/list": [{ beforeId: string }, { reports: ChatReport[] }]
    "reports/resolve": [{ reportId: string }, EmptyResponse]
}

type ChatRoute = keyof ChatRoutes
export type ChatRequest<Route extends ChatRoute> = ChatRoutes[Route][0]
export type ChatResponse<Route extends ChatRoute> = ChatRoutes[Route][1]

export function requestChat<Route extends ChatRoute>(
    route: Route,
    body: ChatRequest<Route>
): Promise<ChatResponse<Route>> {
    const credentials = route === "reports/list" || route === "reports/resolve"
        ? { [gatewayCredentialHeader]: gatewayCredential("CHAT", "reports") } : undefined
    return internalJson(configuredServiceUrl("CHAT"), `${chatPath}/${route}`, body, credentials)
}

export function requestFields(input: unknown): Record<string, unknown> {
    return typeof input === "object" && input !== null && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {}
}

export function isDatabaseId(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2147483647
}

export function isUserIdList(value: unknown): value is number[] {
    return Array.isArray(value) && value.length > 0 && value.length <= 50 && value.every(isDatabaseId)
}

function isCallRoomId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 128
}

function isTimestamp(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15
}

export function parseCallHistoryEntry(input: unknown): CallHistoryEntry | null {
    const { roomId, beginerId, receiverId, confirmedAt, endedAt, instanceId } = requestFields(input)
    if (
        !isCallRoomId(roomId) ||
        !isDatabaseId(beginerId) ||
        !isDatabaseId(receiverId) ||
        beginerId === receiverId ||
        !isTimestamp(confirmedAt) ||
        !isTimestamp(endedAt) ||
        (instanceId !== undefined && (typeof instanceId !== "string" || !instanceId || instanceId.length > 80))
    )
        return null
    return { roomId, beginerId, receiverId, confirmedAt, endedAt, instanceId }
}

export function parseIncomingCallPush(input: unknown): IncomingCallPush | null {
    const { roomId, senderId, senderUsername, recipientId, expiresAt } = requestFields(input)
    if (
        !isCallRoomId(roomId) ||
        !isDatabaseId(senderId) ||
        !isDatabaseId(recipientId) ||
        senderId === recipientId ||
        typeof senderUsername !== "string" ||
        !senderUsername ||
        senderUsername.length > 50 ||
        !isTimestamp(expiresAt)
    )
        return null
    return { roomId, senderId, senderUsername, recipientId, expiresAt }
}
