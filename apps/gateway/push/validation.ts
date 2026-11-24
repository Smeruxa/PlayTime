import type { PushRegistration } from "./types"

export function parsePushRegistration(value: unknown): PushRegistration | null {
    if (!value || typeof value !== "object") {
        return null
    }
    const input = value as Record<string, unknown>
    if (
        input.provider !== "rustore" ||
        typeof input.token !== "string" ||
        input.token.length < 8 ||
        input.token.length > 4096 ||
        !/^[\x21-\x7e]+$/.test(input.token) ||
        typeof input.enabled !== "boolean" ||
        !Array.isArray(input.mutedChats) ||
        input.mutedChats.length > 500
    ) {
        return null
    }
    const mutedChats: string[] = []
    for (const key of input.mutedChats) {
        if (
            typeof key !== "string" ||
            !/^(room:[1-9]\d{0,9}|dm:[^\s]{3,15})$/u.test(key) ||
            Array.from(key).some((character) => character.charCodeAt(0) < 32)
        ) {
            return null
        }
        mutedChats.push(key)
    }
    return {
        provider: "rustore",
        token: input.token,
        enabled: input.enabled,
        mutedChats: [...new Set(mutedChats)]
    }
}
