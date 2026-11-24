import type { AuthedUser } from "../socket/featureContext"
import type { AccessTokenPayload } from "../types/contracts/accessSession"
import { configuredServiceUrl, internalJson } from "./internalHttp"
import { moderationHeader, moderationSecret } from "./moderationAuth"

export const authSessionPath = "/internal/session"
export const authAccountsPath = "/internal/accounts"
export const authSessionChangeChannel = "playtime_auth_session_changes"

export function validSocketToken(token: unknown): token is string {
    return typeof token === "string" && token.length <= 12000 && Boolean(token.trim())
}

export interface UserBlockState {
    isBlocked: boolean
    blockedAt: string | null
    blockedReason: string | null
}

export interface AccountBlockCommand {
    userId: number
    blocked: boolean
    reason: string | null
    clientIp: string
}

export type AccountBlockResult =
    | { kind: "missing" }
    | { kind: "protected" }
    | { kind: "updated"; state: UserBlockState }

export function requestAccountBlock(command: AccountBlockCommand): Promise<AccountBlockResult> {
    return internalJson(configuredServiceUrl("AUTH"), `${authAccountsPath}/block`, command, {
        [moderationHeader]: moderationSecret()
    })
}

export interface VerifiedAccessSession {
    session: AccessTokenPayload
    user: AuthedUser
}

export type BearerAccessResult =
    | { kind: "allowed"; session: AccessTokenPayload }
    | { kind: "blocked" }
    | { kind: "invalid" }

export type BearerAccessVerifier = (token: string) => Promise<BearerAccessResult>

export const requestBearerAccess: BearerAccessVerifier = (token) =>
    internalJson(configuredServiceUrl("AUTH"), `${authSessionPath}/verify-bearer`, { token })

export async function requestRecoveryMailStatus(): Promise<boolean> {
    const { configured } = await internalJson<{ configured: boolean }>(
        configuredServiceUrl("AUTH"),
        `${authAccountsPath}/recovery-mail`,
        {}
    )
    return configured
}

export function createAuthSessionClient() {
    const authApi = configuredServiceUrl("AUTH")
    return {
        verify: (token: string) => internalJson<VerifiedAccessSession>(authApi, `${authSessionPath}/verify`, { token }),
        check: (session: AccessTokenPayload) => internalJson<void>(authApi, `${authSessionPath}/check`, { session })
    }
}
