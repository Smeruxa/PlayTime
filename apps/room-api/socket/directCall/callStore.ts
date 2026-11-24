import crypto from "node:crypto"
import type Redis from "ioredis"
import type { CallEndpoint, CallOwner, CallRoomJson } from "../../../shared/types/contracts/directCall"

export type { CallRoomJson } from "../../../shared/types/contracts/directCall"

export const ROOM_PREFIX = "call:room:"
export const CALL_HISTORY_STREAM = "call:history"
const CALL_RING_DEADLINES = "call:ring-deadlines"
const USER_PREFIX = "call:user:"
const CALL_TTL_SEC = 24 * 60 * 60
export const CALL_RING_MS = 60_000

export type ExpectedCallInstance = {
    expectedInstanceId?: string | null
    expectedExpiresAt?: number | null
}

export type CallActor = CallEndpoint &
    ExpectedCallInstance & {
        ownershipRevision?: number
        previousSocket?: string
        requireOfflineSocket?: boolean
    }

const LUA_HELPERS = `
local roomPrefix, userPrefix = ARGV[1], ARGV[2]
local ringDeadlines = '${CALL_RING_DEADLINES}'
local function syncRingDeadline(id, room)
  if room.status == 'request_receiver' and room.expires_at then
    redis.call('ZADD', ringDeadlines, room.expires_at, id)
  else
    redis.call('ZREM', ringDeadlines, id)
  end
end
local function remove(id, room)
  redis.call('ZREM', ringDeadlines, id)
  redis.call('DEL', roomPrefix .. id)
  for _, uid in ipairs({room.beginer_id, room.receiver_id}) do
    local k = userPrefix .. uid
    if redis.call('GET', k) == id then redis.call('DEL', k) end
  end
end
local function read(id, now)
  if not id then return nil end
  local raw = redis.call('GET', roomPrefix .. id)
  if not raw then return nil end
  local room = cjson.decode(raw)
  if room.status == 'request_receiver' and room.expires_at and room.expires_at <= now then
    remove(id, room)
    return nil
  end
  return room
end
local function current(uid, now)
  local k = userPrefix .. uid
  local id = redis.call('GET', k)
  if not id then return nil, nil end
  local room = read(id, now)
  if not room then redis.call('DEL', k); return nil, nil end
  return id, room
end
local function updateTakeover(room)
  if not room.owners then return end
  local caller, receiver = room.owners[tostring(room.beginer_id)], room.owners[tostring(room.receiver_id)]
  room.takeoverEnabled = not not (caller and caller.modern and receiver and receiver.modern)
end
local function store(id, room, ttl)
  syncRingDeadline(id, room)
  redis.call('SET', roomPrefix .. id, cjson.encode(room), 'EX', ttl)
  redis.call('SET', userPrefix .. room.beginer_id, id, 'EX', ttl)
  redis.call('SET', userPrefix .. room.receiver_id, id, 'EX', ttl)
end
`

const RESERVE =
    LUA_HELPERS +
    `
local caller, callee, id = tonumber(ARGV[3]), tonumber(ARGV[4]), ARGV[5]
local now, ttl = tonumber(ARGV[6]), tonumber(ARGV[7])
local actor = cjson.decode(ARGV[9])
local callerId, callerRoom = current(caller, now)
local calleeId, calleeRoom = current(callee, now)
if callerId then
  if callerRoom.beginer_id == callee and callerRoom.receiver_id == caller then
    if callerRoom.status == 'request_receiver' then
      if not callerRoom.owners and actor.modern and callerRoom.legacyStarter then
        callerRoom.owners = {}
        local starter = callerRoom.legacyStarter
        starter.ownershipRevision = 1
        callerRoom.owners[tostring(callee)] = starter
        callerRoom.takeoverEnabled = false
      end
      if callerRoom.owners then
        if not actor.endpointKey then return cjson.encode({kind='forbidden'}) end
        if not callerRoom.owners[tostring(caller)] then callerRoom.owners[tostring(caller)] = {endpointKey=actor.endpointKey,socketId=actor.socketId,modern=actor.modern,sessionKey=actor.sessionKey,ownershipRevision=1} end
      end
      updateTakeover(callerRoom)
      callerRoom.status = 'in_call'
      callerRoom.confirmed_at = now
      callerRoom.revision = (callerRoom.revision or 1) + 1
      store(callerId, callerRoom, ttl)
    end
    return cjson.encode({kind='joined', roomId=callerId, room=callerRoom})
  end
  if callerRoom.beginer_id == caller and callerRoom.receiver_id == callee then
    return cjson.encode({kind='existing', roomId=callerId, room=callerRoom})
  end
  return cjson.encode({kind='caller_busy'})
end
if calleeId then return cjson.encode({kind='callee_busy'}) end
local room = {instance_id=ARGV[11], status='request_receiver', beginer_id=caller, receiver_id=callee, expires_at=now+tonumber(ARGV[8]), revision=1}
if actor.endpointKey and actor.modern then
  room.owners = {}
  room.owners[tostring(caller)] = {endpointKey=actor.endpointKey,socketId=actor.socketId,modern=actor.modern,sessionKey=actor.sessionKey,ownershipRevision=1}
  room.takeoverEnabled = ARGV[10] == '1'
elseif actor.endpointKey then room.legacyStarter = actor
end
store(id, room, ttl)
return cjson.encode({kind='created', roomId=id, room=room})
`

const TRANSITION =
    LUA_HELPERS +
    `
local id, uid, action = ARGV[3], tonumber(ARGV[4]), ARGV[5]
local now, ttl = tonumber(ARGV[6]), tonumber(ARGV[7])
local raw = redis.call('GET', roomPrefix .. id)
if not raw then
  if action == 'expire' then redis.call('ZREM', ringDeadlines, id) end
  return cjson.encode({kind='missing'})
end
local room = cjson.decode(raw)
local actor = cjson.decode(ARGV[8])
if uid == 0 and action == 'expire' and actor.internal then uid = room.beginer_id end
if actor.expectedInstanceId ~= nil and actor.expectedInstanceId ~= (room.instance_id or cjson.null) then return cjson.encode({kind='forbidden'}) end
if actor.expectedExpiresAt ~= nil and actor.expectedExpiresAt ~= (room.expires_at or cjson.null) then return cjson.encode({kind='forbidden'}) end
if action ~= 'expire' and room.status == 'request_receiver' and room.expires_at and room.expires_at <= now then
  remove(id, room)
  return cjson.encode({kind='missing'})
end
if uid ~= room.beginer_id and uid ~= room.receiver_id then return cjson.encode({kind='forbidden'}) end
if action == 'accept' or action == 'reject' then
  if uid ~= room.receiver_id then return cjson.encode({kind='forbidden'}) end
end
if not room.owners and action == 'accept' and actor.modern and room.legacyStarter then
  room.owners = {}
  local starter = room.legacyStarter
  starter.ownershipRevision = 1
  room.owners[tostring(room.beginer_id)] = starter
  room.takeoverEnabled = false
end
if not room.owners and action == 'end' and actor.modern then return cjson.encode({kind='forbidden'}) end
if room.owners and action ~= 'expire' and not actor.internal then
  local owner = room.owners[tostring(uid)]
  if owner then
    if action == 'end' and (owner.modern or actor.ownershipRevision) and actor.ownershipRevision ~= owner.ownershipRevision then return cjson.encode({kind='forbidden'}) end
    if owner.endpointKey ~= actor.endpointKey or owner.socketId ~= actor.socketId or redis.call('GET', 'call:endpoint:' .. owner.endpointKey) ~= actor.socketId then return cjson.encode({kind='forbidden'}) end
    if actor.requireOfflineSocket and redis.call('EXISTS', 'call:socket:' .. owner.socketId) ~= 0 then return cjson.encode({kind='forbidden'}) end
  elseif action == 'accept' or action == 'reject' then
    if not actor.endpointKey then return cjson.encode({kind='forbidden'}) end
    room.owners[tostring(uid)] = {endpointKey=actor.endpointKey,socketId=actor.socketId,modern=actor.modern,sessionKey=actor.sessionKey,ownershipRevision=1}
  else return cjson.encode({kind='forbidden'}) end
end
if action == 'accept' then
  updateTakeover(room)
  if room.status ~= 'in_call' then
    room.status = 'in_call'; room.confirmed_at = now; room.revision = (room.revision or 1)+1
  end
  store(id, room, ttl)
  return cjson.encode({kind='accepted', roomId=id, room=room})
end
if action == 'reject' and room.status ~= 'request_receiver' then return cjson.encode({kind='already_accepted', roomId=id, room=room}) end
if action == 'expire' and (room.status ~= 'request_receiver' or (room.expires_at or 0) > now) then
  syncRingDeadline(id, room)
  return cjson.encode({kind='unchanged', roomId=id, room=room})
end
if ARGV[9] and ARGV[9] ~= '' and room.confirmed_at and room.confirmed_at > 0 then
  local event = {
    roomId=id, beginerId=room.beginer_id, receiverId=room.receiver_id,
    confirmedAt=room.confirmed_at, endedAt=now, instanceId=room.instance_id
  }
  redis.call('XADD', ARGV[9], '*', 'call', cjson.encode(event))
end
remove(id, room)
return cjson.encode({kind='ended', roomId=id, room=room})
`

const CURRENT =
    LUA_HELPERS +
    `
local id, room = current(tonumber(ARGV[3]), tonumber(ARGV[4]))
if not id then return cjson.encode({kind='missing'}) end
if not room.owners then store(id, room, tonumber(ARGV[5])) end
return cjson.encode({kind='existing', roomId=id, room=room})
`

const OWNERSHIP =
    LUA_HELPERS +
    `
local id, uid, action = ARGV[3], tonumber(ARGV[4]), ARGV[5]
local actor, expected, targetExpected = cjson.decode(ARGV[6]), tonumber(ARGV[7]), tonumber(ARGV[8])
local room = read(id, tonumber(ARGV[9]))
if not room then return cjson.encode({kind='missing'}) end
if uid ~= room.beginer_id and uid ~= room.receiver_id then return cjson.encode({kind='forbidden'}) end
if action == 'signal' and room.status ~= 'in_call' then return cjson.encode({kind='forbidden'}) end
if not room.owners then
  if actor.modern and action ~= 'attach' then return cjson.encode({kind='forbidden'}) end
  if action == 'claim' then return cjson.encode({kind='forbidden'}) end
  return cjson.encode({kind='existing',roomId=id,room=room})
end
local owner = room.owners[tostring(uid)]
local peerId = uid == room.beginer_id and room.receiver_id or room.beginer_id
local peer = room.owners[tostring(peerId)]
if not actor.endpointKey or redis.call('GET', 'call:endpoint:' .. actor.endpointKey) ~= actor.socketId then return cjson.encode({kind='forbidden'}) end
if action == 'legacyAttach' then
  if not owner or owner.modern or actor.modern or not owner.sessionKey or owner.sessionKey ~= actor.sessionKey or owner.socketId ~= actor.previousSocket or owner.ownershipRevision ~= expected or redis.call('EXISTS', 'call:socket:' .. owner.socketId) ~= 0 then return cjson.encode({kind='forbidden'}) end
  owner.endpointKey = actor.endpointKey
  owner.socketId = actor.socketId
  store(id,room,tonumber(ARGV[10]))
elseif action == 'attach' then
  if owner and owner.endpointKey == actor.endpointKey then
    owner.socketId = actor.socketId
    store(id,room,tonumber(ARGV[10]))
  end
elseif action == 'claim' then
  if room.status ~= 'in_call' or not room.takeoverEnabled or not owner or not peer or not owner.modern or not peer.modern then return cjson.encode({kind='forbidden'}) end
  if owner.endpointKey == actor.endpointKey then
    owner.socketId = actor.socketId
  else
    if expected ~= owner.ownershipRevision then return cjson.encode({kind='stale'}) end
    local previous = owner
    owner = {endpointKey=actor.endpointKey,socketId=actor.socketId,modern=actor.modern,ownershipRevision=previous.ownershipRevision+1}
    room.owners[tostring(uid)] = owner
    room.revision = (room.revision or 1)+1
    store(id,room,tonumber(ARGV[10]))
    return cjson.encode({kind='claimed',roomId=id,room=room,previousOwner=previous})
  end
  store(id,room,tonumber(ARGV[10]))
else
  if not owner or owner.endpointKey ~= actor.endpointKey or owner.socketId ~= actor.socketId then return cjson.encode({kind='forbidden'}) end
  if owner.modern and expected ~= owner.ownershipRevision then return cjson.encode({kind='forbidden'}) end
  if action == 'signal' and (not peer or (owner.modern and (expected ~= owner.ownershipRevision or targetExpected ~= peer.ownershipRevision))) then return cjson.encode({kind='forbidden'}) end
  if action == 'heartbeat' then
    redis.call('EXPIRE', 'call:endpoint:' .. actor.endpointKey, tonumber(ARGV[10]))
    redis.call('EXPIRE', 'call:socket:' .. actor.socketId, tonumber(ARGV[10]))
    store(id,room,tonumber(ARGV[10]))
  end
end
return cjson.encode({kind='existing',roomId=id,room=room})
`

const REPAIR_LEGACY = LUA_HELPERS + `
local id = ARGV[3]
local key = roomPrefix .. id
local raw = redis.call('GET', key)
if not raw then return end
local room = cjson.decode(raw)
if room.instance_id then return syncRingDeadline(id, room) end
local users = {room.beginer_id, room.receiver_id}
for _, uid in ipairs(users) do
  local indexed = redis.call('GET', userPrefix .. uid)
  if indexed and indexed ~= id then return end
end
local remaining = redis.call('PTTL', key)
if remaining == 0 or remaining == -2 then return end
local ttl = remaining == -1 and tonumber(ARGV[5]) or remaining
if not room.revision or (room.status == 'request_receiver' and not room.expires_at) then
  room.revision = room.revision or (room.status == 'in_call' and 2 or 1)
  if room.status == 'request_receiver' then room.expires_at = room.expires_at or tonumber(ARGV[4]) end
  redis.call('SET', key, cjson.encode(room), 'PX', ttl)
elseif remaining == -1 then
  redis.call('PEXPIRE', key, ttl)
end
for _, uid in ipairs(users) do
  redis.call('SET', userPrefix .. uid, id, 'PX', ttl)
end
syncRingDeadline(id, room)
`

export type CallStoreResult = {
    previousOwner?: CallOwner
    kind:
        | "claimed"
        | "stale"
        | "created"
        | "joined"
        | "existing"
        | "caller_busy"
        | "callee_busy"
        | "accepted"
        | "ended"
        | "missing"
        | "forbidden"
        | "already_accepted"
        | "unchanged"
    roomId?: string
    room?: CallRoomJson
}

export function createCallStore(redis: Pick<Redis, "eval" | "get" | "scan" | "set" | "del" | "zrangebyscore">) {
    let durableHistory = false
    const evaluate = async (script: string, ...args: (string | number)[]): Promise<CallStoreResult> => {
        const scalars = args.map((value) => {
            if (typeof value === "string") return value
            if (typeof value === "number" && Number.isSafeInteger(value)) return String(value)
            throw new TypeError("Invalid call store argument")
        })
        return JSON.parse(String(await redis.eval(script, 0, ROOM_PREFIX, USER_PREFIX, ...scalars))) as CallStoreResult
    }

    async function* roomKeys(): AsyncGenerator<string> {
        let cursor = "0"
        do {
            const [next, keys] = await redis.scan(cursor, "MATCH", ROOM_PREFIX + "*", "COUNT", 64)
            cursor = next
            yield* keys
        } while (cursor !== "0")
    }

    return {
        enableDurableHistory() {
            durableHistory = true
        },
        reserve: (caller: number, callee: number, uniqueSession = true, actor?: CallActor, takeoverEnabled = false) =>
            evaluate(
                RESERVE,
                caller,
                callee,
                `${caller}:${callee}${uniqueSession ? ":" + crypto.randomUUID() : ""}`,
                Date.now(),
                CALL_TTL_SEC,
                CALL_RING_MS,
                JSON.stringify(actor ?? {}),
                takeoverEnabled ? "1" : "0",
                crypto.randomUUID()
            ),
        transition: (
            roomId: string,
            userId: number,
            action: "accept" | "reject" | "end" | "expire",
            actor?: CallActor | ({ internal: true } & ExpectedCallInstance),
            recordHistory = true
        ) =>
            evaluate(
                TRANSITION,
                roomId,
                userId,
                action,
                Date.now(),
                CALL_TTL_SEC,
                JSON.stringify(actor ?? { internal: true }),
                durableHistory && recordHistory ? CALL_HISTORY_STREAM : ""
            ),
        dueRingDeadlines: () => redis.zrangebyscore(CALL_RING_DEADLINES, "-inf", Date.now(), "LIMIT", 0, 32),
        expirePendingRing: (roomId: string) =>
            evaluate(TRANSITION, roomId, 0, "expire", Date.now(), CALL_TTL_SEC, JSON.stringify({ internal: true })),
        ownership: (
            roomId: string,
            userId: number,
            action: "legacyAttach" | "attach" | "claim" | "signal" | "heartbeat" | "authorize",
            actor?: CallActor,
            expected = -1,
            targetExpected = -1
        ) =>
            evaluate(
                OWNERSHIP,
                roomId,
                userId,
                action,
                JSON.stringify(actor ?? {}),
                expected,
                targetExpected,
                Date.now(),
                CALL_TTL_SEC
            ),
        registerEndpoint: (actor: CallActor) =>
            redis.eval(
                `
redis.call('SET', 'call:endpoint:' .. ARGV[1], ARGV[2], 'EX', ARGV[3])
redis.call('SET', 'call:socket:' .. ARGV[2], '1', 'EX', ARGV[3])
return 1`,
                0,
                actor.endpointKey,
                actor.socketId,
                CALL_TTL_SEC
            ),
        renewEndpoint: (actor: CallActor) =>
            redis.eval(
                `
local key = 'call:endpoint:' .. ARGV[1]
local current = redis.call('GET', key)
if current and current ~= ARGV[2] then return 0 end
redis.call('SET', key, ARGV[2], 'EX', ARGV[3])
redis.call('SET', 'call:socket:' .. ARGV[2], '1', 'EX', ARGV[3])
return 1`,
                0,
                actor.endpointKey,
                actor.socketId,
                CALL_TTL_SEC
            ),
        disconnectEndpoint: (socketId: string) => redis.del("call:socket:" + socketId),
        current: (userId: number) => evaluate(CURRENT, userId, Date.now(), CALL_TTL_SEC),
        async get(roomId: string): Promise<CallRoomJson | null> {
            const raw = await redis.get(ROOM_PREFIX + roomId)
            if (!raw) return null
            const room = JSON.parse(raw) as CallRoomJson
            if (room.status === "request_receiver" && room.expires_at && room.expires_at <= Date.now()) return null
            return room
        },
        async remove(roomId: string): Promise<void> {
            const raw = await redis.get(ROOM_PREFIX + roomId)
            if (!raw) return
            const room = JSON.parse(raw) as CallRoomJson
            await evaluate(
                TRANSITION,
                roomId,
                room.beginer_id,
                "end",
                Date.now(),
                CALL_TTL_SEC,
                JSON.stringify({ internal: true })
            )
        },
        async list(): Promise<{ key: string; room: CallRoomJson }[]> {
            const rooms: { key: string; room: CallRoomJson }[] = []
            for await (const key of roomKeys()) {
                const raw = await redis.get(key)
                if (raw) rooms.push({ key, room: JSON.parse(raw) as CallRoomJson })
            }
            return rooms
        },
        async repairLegacyRooms(): Promise<void> {
            for await (const key of roomKeys()) {
                await redis.eval(
                    REPAIR_LEGACY,
                    0,
                    ROOM_PREFIX,
                    USER_PREFIX,
                    key.slice(ROOM_PREFIX.length),
                    Date.now() + CALL_RING_MS,
                    CALL_TTL_SEC * 1000
                )
            }
        },
        async importLegacy(roomId: string, room: CallRoomJson): Promise<boolean> {
            const result = await redis.eval(
                LUA_HELPERS +
                    `
local id, room, ttl = ARGV[3], cjson.decode(ARGV[4]), tonumber(ARGV[5])
for _, uid in ipairs({room.beginer_id, room.receiver_id}) do
  local currentId = redis.call('GET', userPrefix .. uid)
  if currentId and currentId ~= id then return 0 end
end
store(id, room, ttl)
return 1`,
                0,
                ROOM_PREFIX,
                USER_PREFIX,
                roomId,
                JSON.stringify(room),
                CALL_TTL_SEC
            )
            return Number(result) === 1
        }
    }
}
