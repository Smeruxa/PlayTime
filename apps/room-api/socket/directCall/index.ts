import type { FeatureContext } from "../../../shared/socket/featureContext"
import { registerCallCommands } from "./commands"
import { registerCallControl } from "./control"
import { createCallLifecycle } from "./lifecycle"
import { registerCallMedia } from "./media"
import { registerDirectCallRecovery } from "./recovery"
import { callStore, getAllRooms, getRoom, ROOM_PREFIX } from "./redisService"
import type { DirectCallServices } from "./services"
import { createCallState } from "./state"

export type { DirectCallServices } from "./services"

export default function registerDirectCall(
    context: FeatureContext,
    services: DirectCallServices,
    durableDisconnects = false
): void {
    const state = createCallState(context, services)
    const lifecycle = createCallLifecycle(context.io, services.logEnded)
    registerDirectCallRecovery(context, {
        getRoom,
        getAllRooms,
        roomPrefix: ROOM_PREFIX,
        durableDisconnects,
        endCall: lifecycle.endCall,
        notifyEnded: lifecycle.notifyEnded,
        getUserRoom: async (id) => {
            const result = await callStore.current(id)
            return result.room && result.roomId ? { key: ROOM_PREFIX + result.roomId, room: result.room } : null
        }
    })
    registerCallControl(context, services, state, lifecycle)
    registerCallCommands(context, services, state, lifecycle)
    registerCallMedia(context, services)
}
