import { Router } from "express"
import attachmentRoutes from "../routes/attachments"
import peerSafetyRoutes from "../routes/peerSafety"
import voiceRoutes from "../routes/voice"

const chatPublicRoutes = Router()
chatPublicRoutes.use("/playtime/voice", voiceRoutes)
chatPublicRoutes.use("/playtime/attachments", attachmentRoutes)
chatPublicRoutes.use("/playtime/peers", peerSafetyRoutes)

export default chatPublicRoutes
