import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"
import WebSocket from "ws"
import { createDomainSocket } from "./domainSocket"
import { gatewayCredential, gatewayCredentialHeader, internalHeader, internalSecret } from "./internalHttp"
import { ServiceRelay } from "./relay"
import {
    gatewaySlotHeader,
    multiGatewayRelayVersion,
    relayVersionHeader,
    type GatewaySlot,
    type SocketSnapshot
} from "./socketProtocol"

function gatewayHeaders(slot?: GatewaySlot): Record<string, string> {
    return {
        [internalHeader]: internalSecret(),
        [gatewayCredentialHeader]: gatewayCredential("AUTH", "socket"),
        ...(slot ? { [gatewaySlotHeader]: slot, [relayVersionHeader]: multiGatewayRelayVersion } : {})
    }
}

function socketState(id: string): SocketSnapshot {
    const user = { id: 1, username: "test" }
    return {
        id,
        user,
        session: { ...user, exp: 0, jti: id, sessionVersion: 0 },
        auth: {},
        rooms: [id, "1"],
        roomRevision: 0,
        sessionRevision: 0
    }
}

async function gateway(url: string, id: string, slot?: GatewaySlot) {
    const socket = new WebSocket(url, { headers: gatewayHeaders(slot) })
    await once(socket, "open")
    const state = socketState(id)
    const events: string[] = []
    const relay = new ServiceRelay(socket, {
        "io:emit": (_, __, event) => {
            events.push(event)
        },
        "io:fetch": () => [state],
        "io:membership": (socketId, operation, room) => {
            assert.equal(socketId, id)
            events.push(`${operation}:${room}`)
            return state
        },
        "io:disconnect": () => {
            events.push("disconnect")
        }
    })
    await relay.request("socket:connect", state)
    return { relay, state, events }
}

test("gateway slots share domain effects and preserve the original relay protocol", { timeout: 8000 }, async (t) => {
    process.env.PLAYTIME_INTERNAL_SECRET = randomBytes(32).toString("hex")
    process.env.PLAYTIME_AUTH_RELAY_SECRET = randomBytes(32).toString("hex")
    const server = createServer()
    const domain = createDomainSocket(server, "AUTH", { register() {} })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    t.after(async () => {
        await domain.close()
        await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const address = server.address()
    assert.ok(address && typeof address === "object")
    const url = `ws://127.0.0.1:${address.port}/internal/gateway`
    const primary = await gateway(url, "primary-id")
    const secondary = await gateway(url, "secondary-id", "secondary")
    const duplicate = new WebSocket(url, { headers: gatewayHeaders("primary") })
    await assert.rejects(once(duplicate, "open"), /Unexpected server response: 403/)

    const room = domain.io.in("1")
    const sockets = await room.fetchSockets()
    assert.deepEqual(sockets.map(({ id }) => id).sort(), ["primary-id", "secondary-id"])
    await sockets.find(({ id }) => id === "secondary-id")!.leave("room:7")

    room.emit("chat:message")
    domain.multiGatewayIo.to("1").emit("presence:changed")
    secondary.relay.notify("gateway:planChanged", 1, "pro")
    await secondary.relay.request("socket:refresh", secondary.state)
    room.disconnectSockets(true)
    await room.fetchSockets()

    assert.deepEqual(primary.events, ["chat:message", "subscription:planChanged", "disconnect"])
    assert.deepEqual(secondary.events, [
        "leave:room:7",
        "chat:message",
        "presence:changed",
        "subscription:planChanged",
        "disconnect"
    ])
})
