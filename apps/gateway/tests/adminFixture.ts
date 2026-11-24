import assert from "node:assert/strict"
import { createHash } from "node:crypto"
export { closeAdminSessionStore as closeAdminFixture } from "../admin/adminSession"

export const ADMIN_TEST_KEY = Buffer.alloc(32, 37).toString("base64url")
export const ADMIN_TEST_ORIGIN = "https://site.example.test"

export function configureAdminFixture(): void {
    process.env.ADMIN_ACCESS_KEY_HASH = createHash("sha256").update(ADMIN_TEST_KEY).digest("hex")
    process.env.ADMIN_SESSION_SIGNING_KEY = Buffer.alloc(32, 42).toString("hex")
    process.env.SITE_ORIGIN = ADMIN_TEST_ORIGIN
}

export async function loginAdminFixture(base: string): Promise<string> {
    const response = await fetch(`${base}/admin/session`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-PlayTime-Admin": "1",
            Origin: ADMIN_TEST_ORIGIN
        },
        body: JSON.stringify({ key: ADMIN_TEST_KEY })
    })
    assert.equal(response.status, 200, "Test admin session must be issued")
    const cookie = response.headers.get("set-cookie")?.split(";")[0]
    assert.ok(cookie, "Test admin session must include a cookie")
    return cookie
}
