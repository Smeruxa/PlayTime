import rateLimit from "express-rate-limit"
import type { Redis } from "ioredis"
import { RedisStore, type RedisReply } from "rate-limit-redis"

function redisStore(client: Redis, prefix: string): RedisStore {
    return new RedisStore({
        sendCommand: (command: string, ...args: string[]) => client.call(command, ...args) as Promise<RedisReply>,
        prefix
    })
}

export function createAuthRateLimiters(client: Redis) {
    const loginRegisterLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 120,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Слишком много запросов. Повторите позже." },
        store: redisStore(client, "rl:auth:login_reg:")
    })

    const tokenValidLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Слишком много запросов. Повторите позже." },
        store: redisStore(client, "rl:auth:token_valid:")
    })

    const refreshLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Слишком много запросов. Повторите позже." },
        store: redisStore(client, "rl:auth:refresh:")
    })

    const revokeLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Слишком много запросов. Повторите позже." },
        store: redisStore(client, "rl:auth:revoke:")
    })

    return { loginRegisterLimiter, tokenValidLimiter, refreshLimiter, revokeLimiter }
}
