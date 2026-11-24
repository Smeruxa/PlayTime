import { createPresence } from "../shared/runtime/presence"

export const { setPresenceSource, invalidatePresenceFriends, onConnect, onDisconnect, registerPresenceHandlers } =
    createPresence()

export default registerPresenceHandlers
