import type { Express } from "express"
import type { FeatureContext, FeatureIo } from "../shared/socket/featureContext"
import registerDirectCall from "./socket/directCall"
import { rememberCallDisconnect, startCallDisconnectWorker } from "./socket/directCall/disconnectDeadlines"
import { registerCallEndpoint } from "./socket/directCall/ownership"
import { callStore, initializeDirectCalls } from "./socket/directCall/redisService"
import { startRingExpiryWorker } from "./socket/directCall/ringExpiryWorker"
import registerPartyMedia from "./socket/party/partyMedia"
import registerPartyRoomsSocket from "./socket/party/roomsSocket"
import { startPartyDepartureWorker } from "./socket/party/departures"
import registerWebrtcSignaling from "./socket/webrtc/signaling"
import { mountBlockPeersRoute } from "./blockPeersRoute"
import { mountRingingRecipientRoute } from "./ringingRecipientRoute"
import { startCallHistoryWorker } from "./callHistoryWorker"
import { areCallPeersBlocked, directCallServices, partyServices } from "./chatPolicy"

const durableDisconnects = process.env.PLAYTIME_DOMAIN_ROLLOUT === "1"

export async function configureRoomApi(app: Express, io: FeatureIo, hasGatewayLinks: () => boolean): Promise<() => void> {
    await initializeDirectCalls()
    callStore.enableDurableHistory()
    mountBlockPeersRoute(app, io)
    mountRingingRecipientRoute(app)
    const stopCallHistory = startCallHistoryWorker()
    const stopRingExpiry = startRingExpiryWorker(io, hasGatewayLinks)
    const stopDisconnects = durableDisconnects ? startCallDisconnectWorker(io, hasGatewayLinks) : undefined
    const stopPartyDepartures = durableDisconnects ? startPartyDepartureWorker(io, hasGatewayLinks) : undefined
    return () => {
        stopCallHistory()
        stopRingExpiry()
        stopDisconnects?.()
        stopPartyDepartures?.()
    }
}

export function registerRoomSocketFeatures(ctx: FeatureContext): void {
    registerDirectCall(ctx, directCallServices, durableDisconnects)
    registerPartyRoomsSocket(ctx, partyServices, durableDisconnects)
    registerPartyMedia(ctx, partyServices.limits)
    registerWebrtcSignaling(ctx, areCallPeersBlocked)
}

export async function connectRoomSocket(ctx: FeatureContext, renewal = false): Promise<void> {
    await registerCallEndpoint(ctx.socket, ctx.user.id, renewal)
}

export async function disconnectRoomSocket(ctx: FeatureContext): Promise<void> {
    await ctx.socket.data.callEndpointReady
    try {
        if (durableDisconnects) await rememberCallDisconnect(ctx)
    } finally {
        await callStore.disconnectEndpoint(ctx.socket.id)
    }
}
