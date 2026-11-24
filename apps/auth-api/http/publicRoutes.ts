import { json, Router } from "express"
import accountRecoveryRoutes from "../routes/accountRecovery"
import authRoutes from "../routes/auth"
import emailVerificationRoutes from "../routes/emailVerification"
import keyTransferRoutes from "../routes/keyTransfer"
import sessionsRoutes from "../routes/sessions"

const authPublicRoutes = Router()
authPublicRoutes.use("/playtime/auth", json({ limit: "32kb" }))
authPublicRoutes.use("/playtime/auth/sessions", sessionsRoutes)
authPublicRoutes.use("/playtime/auth/key-transfer", keyTransferRoutes)
authPublicRoutes.use("/playtime/auth", authRoutes, accountRecoveryRoutes, emailVerificationRoutes)

export default authPublicRoutes
