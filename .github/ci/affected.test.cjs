const assert = require("node:assert/strict")
const { test } = require("node:test")
const { changedPaths, planForPaths } = require("./affected.cjs")

test("documentation changes leave the check matrix empty", () => {
    assert.deepEqual(planForPaths(["README.md", "apps/auth-api/README.md", "docs/notes.txt"]), {
        applications: [],
        lanes: [],
        serviceScopes: []
    })
})

test("auth affects its runtime consumers and their bundle", () => {
    assert.deepEqual(planForPaths(["apps/auth-api/app.ts"]), {
        applications: ["auth-api", "chat-api", "room-api", "gateway"],
        lanes: ["services", "archive"],
        serviceScopes: ["auth-api", "chat-api", "room-api", "gateway"]
    })
})

test("gateway-only changes do not add other server scopes", () => {
    assert.deepEqual(planForPaths(["apps/gateway/routes/billing.ts"]), {
        applications: ["gateway"],
        lanes: ["services", "archive"],
        serviceScopes: ["gateway"]
    })
    for (const file of ["apps/chat-api/app.ts", "apps/room-api/app.ts"]) {
        assert.deepEqual(planForPaths([file]).serviceScopes, ["chat-api", "room-api", "gateway"])
    }
})

test("database changes affect every server and the archive", () => {
    for (const file of ["apps/database/migrations/035_example.sql", "apps/tsconfig.json"]) {
        assert.deepEqual(planForPaths([file]).lanes, ["services", "archive"])
    }
    assert.deepEqual(planForPaths(["apps/database/migrations/035_example.sql"]).serviceScopes, [
        "auth-api", "chat-api", "room-api", "gateway", "database"
    ])
})

test("shared contracts affect all apps and root dependency changes select all lanes", () => {
    const full = ["services", "frontend", "site", "mobile", "android", "archive"]
    assert.deepEqual(planForPaths(undefined).lanes, full)
    for (const file of ["package-lock.json", ".github/workflows/ci.yml"]) {
        assert.deepEqual(planForPaths([file]).lanes, full)
    }
    assert.deepEqual(planForPaths(["apps/shared/types/contracts/webrtc.ts"]).applications, [
        "auth-api", "chat-api", "room-api", "gateway", "frontend", "site", "mobile"
    ])
    assert.deepEqual(planForPaths(["apps/shared/types/contracts/webrtc.ts"]).serviceScopes, [
        "auth-api", "chat-api", "room-api", "gateway", "shared", "database"
    ])
    assert.deepEqual(planForPaths(["apps/package-lock.json"]).lanes, ["services", "frontend", "site", "mobile", "archive"])
    assert.equal(changedPaths("workflow_dispatch", {}), undefined)
    assert.equal(changedPaths("push", { before: "0".repeat(40) }), undefined)
})

test("server modules used by client tests select those tests", () => {
    assert.deepEqual(planForPaths(["apps/gateway/http/serveSite.ts"]).lanes, [
        "services", "frontend", "site", "mobile", "archive"
    ])
    assert.deepEqual(planForPaths(["apps/chat-api/utils/e2eeWire.ts"]).lanes, ["services", "mobile", "archive"])
})

test("frontend affects site delivery and mobile protocol tests", () => {
    assert.deepEqual(planForPaths(["apps/frontend/src/ui/Dialog.tsx"]).lanes, ["frontend", "site", "mobile", "archive"])
    assert.deepEqual(planForPaths(["apps/site/src/main.tsx"]).lanes, ["site", "archive"])
})

test("mobile and deployment changes have independent lanes", () => {
    assert.deepEqual(planForPaths(["mobile/src/services/client.ts"]).lanes, ["mobile"])
    assert.deepEqual(planForPaths(["mobile/android/app/build.gradle"]).lanes, ["mobile", "android"])
    for (const file of [
        "deploy_backend/upload.sh", "Dockerfile", ".dockerignore", "deploy/k8s/base/kustomization.yaml",
        "deploy/k8s/migrations/job.yaml", "deploy/k8s/ingress.example.yaml"
    ]) {
        assert.deepEqual(planForPaths([file]).lanes, ["archive"])
    }
})
