export type AccessTokenPayload = {
    id: number
    username: string
    jti: string
    exp: number
    sessionVersion: number
    sessionId?: string
}

export const accessSessionRoom = (jti: string): string => `auth:access:${jti}`
export const deviceSessionRoom = (sessionId: string): string => `auth:device:${sessionId}`
