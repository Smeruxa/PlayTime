import { JWT_SECRET } from "../../shared/config"
import { matchesRecoveryCode, recoveryCodeHash } from "./recoveryCode"

type Scope = { userId: number; requesterSessionId: string; targetSessionId: string | null }
function secret(challengeId: string, scope: Scope): string {
    return `${JWT_SECRET}:session-revocation:${scope.userId}:${scope.requesterSessionId}:${challengeId}:${scope.targetSessionId ?? "others"}`
}
export function sessionRevocationCodeHash(code: string, challengeId: string, scope: Scope): string {
    return recoveryCodeHash(code, secret(challengeId, scope))
}
export function matchesSessionRevocationCode(code: string, hash: string, challengeId: string, scope: Scope): boolean {
    return matchesRecoveryCode(code, hash, secret(challengeId, scope))
}
