import { assertAccessSessionActive, verifySocketSession } from "../../auth-api/auth/socketSession"
import { registerCallEndpoint } from "../../room-api/socket/directCall/ownership"
import { createSocketAuth } from "../middlewares/authMiddleware"

export const authSocket = createSocketAuth({
    verify: (token) => verifySocketSession(token, true),
    check: assertAccessSessionActive,
    refreshEndpoint: async (socket) => {
        await registerCallEndpoint(socket, socket.data.accessSession.id, true)
    }
})
