import assert from "node:assert/strict"
import test from "node:test"
import type { Request, Response, NextFunction } from "express"
import { isAdminIpAllowed } from "../../apps/shared/http/clientIp"
import { adminWriteMiddleware } from "../../apps/gateway/middlewares/adminWriteMiddleware"
process.env.ADMIN_IP_WHITELIST = "192.0.2.10"
process.env.TRUSTED_PROXY_IPS = "127.0.0.1,::1"
const req = (remote: string, headers: Record<string, string> = {}) =>
    ({ socket: { remoteAddress: remote }, headers }) as Request

test("only an allowed client IP or an explicitly trusted proxy can authorize an admin", () => {
    assert.equal(isAdminIpAllowed(req("192.0.2.10")), true)
    assert.equal(
        isAdminIpAllowed(req("198.51.100.3", { "x-real-ip": "192.0.2.10", "x-forwarded-for": "192.0.2.10" })),
        false
    )
    assert.equal(isAdminIpAllowed(req("127.0.0.1", { "x-real-ip": "192.0.2.10" })), true)
    assert.equal(isAdminIpAllowed(req("127.0.0.1", { "x-forwarded-for": "192.0.2.10" })), false)
    assert.equal(isAdminIpAllowed(req("127.0.0.1", { "x-real-ip": "198.51.100.3" })), false)
})
test("admin mutations reject cross-site forms and accept the admin application's custom header", () => {
    for (const [method, header, expected] of [
        ["GET", "", true],
        ["POST", "", false],
        ["PUT", "", false],
        ["PATCH", "1", true],
        ["DELETE", "1", true]
    ] as const) {
        let allowed = false,
            status = 200
        const response = {
            setHeader() {},
            status(value: number) {
                status = value
                return this
            },
            json() {}
        }
        adminWriteMiddleware(
            { method, get: () => header } as unknown as Request,
            response as unknown as Response,
            (() => {
                allowed = true
            }) as NextFunction
        )
        assert.equal(allowed, expected)
        if (!expected) assert.equal(status, 403)
    }
})
