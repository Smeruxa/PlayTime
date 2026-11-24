import type { AccessTokenPayload } from "../types/contracts/accessSession"
import type { AuthedUser, RoomTarget } from "../socket/featureContext"
import type { PlanSlug } from "../subscription/planCatalog"

export type { RoomTarget } from "../socket/featureContext"

export const gatewaySlotHeader = "x-playtime-gateway-slot"
export const relayVersionHeader = "x-playtime-relay-version"
export const domainReplicaHeader = "x-playtime-domain-replica"
export const multiGatewayRelayVersion = "2"
export type GatewaySlot = "primary" | "secondary"

export interface SocketSnapshot {
    id: string
    user: AuthedUser
    session: AccessTokenPayload
    auth: {
        peerIdentityProtocol?: number
        callProtocol?: number
        callEndpointId?: string
    }
    rooms: string[]
    roomRevision: number
    sessionRevision: number
}

export interface SocketCommand {
    event: string
    args: unknown[]
    expectsAck: boolean
}

interface RequestContract {
    "socket:connect": { args: [snapshot: SocketSnapshot]; result: void }
    "socket:attach": { args: [snapshot: SocketSnapshot]; result: void }
    "socket:detach": { args: [snapshot: SocketSnapshot]; result: void }
    "socket:refresh": { args: [snapshot: SocketSnapshot]; result: void }
    "socket:dispatch": { args: [snapshot: SocketSnapshot, command: SocketCommand]; result: unknown[] | undefined }
    "io:emit": { args: NotificationContract["io:emit"]; result: void }
    "io:fetch": { args: [rooms: RoomTarget]; result: SocketSnapshot[] }
    "io:membership": {
        args: [socketId: string, operation: "join" | "leave", room: string]
        result: SocketSnapshot | null
    }
    "domain:drain": { args: []; result: void }
}

interface NotificationContract {
    "domain:ready": []
    "socket:rooms": [snapshot: SocketSnapshot]
    "socket:leaving": [snapshot: SocketSnapshot]
    "socket:disconnect": [socketId: string]
    "io:emit": [rooms: RoomTarget, except: string | undefined, event: string, args: unknown[]]
    "io:disconnect": [rooms: RoomTarget, close: boolean]
    "io:leaveAll": [rooms: RoomTarget, room: string]
    "io:serverSide": [event: string, args: unknown[]]
    "gateway:planChanged": [userId: number, planSlug: PlanSlug]
}

export type RequestName = keyof RequestContract
export type RequestArgs<Name extends RequestName> = RequestContract[Name]["args"]
export type RequestResult<Name extends RequestName> = RequestContract[Name]["result"]
export type NotificationName = keyof NotificationContract
export type NotificationArgs<Name extends NotificationName> = NotificationContract[Name]

type RequestHandlers = {
    [Name in RequestName]?: (...args: RequestArgs<Name>) => RequestResult<Name> | Promise<RequestResult<Name>>
}
type NotificationHandlers = {
    [Name in NotificationName]?: (...args: NotificationArgs<Name>) => void | Promise<void>
}

export type RelayHandlers = RequestHandlers & NotificationHandlers
