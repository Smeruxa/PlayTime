import { resolveDirectCallResponse, type DirectCallState } from "./directCallState"
import type { CallProps } from "../types"

const legacy: CallProps = { names: ["Alice", "Bob"], roomId: "1:2", incoming: false, confirmed: true }
const canonical: DirectCallState = {
    roomId: "1:2",
    status: "in_call",
    revision: 3,
    caller: { id: 1, username: "Alice", ownershipRevision: 2 },
    receiver: { id: 2, username: "Bob", ownershipRevision: 1 },
    media: { active: true, canClaim: true, ownershipRevision: 2 }
}

test("start and accept acknowledgements preserve authoritative owner epochs", () => {
    expect(resolveDirectCallResponse(canonical, 1, legacy)).toMatchObject({
        ownershipRevision: 2,
        peerOwnershipRevision: 1,
        confirmed: true,
        revision: 3
    })
})

test("a passive or ended acknowledgement cannot fall back to an active legacy call", () => {
    expect(
        resolveDirectCallResponse({ ...canonical, media: { ...canonical.media!, active: false } }, 1, legacy)
    ).toBeNull()
    expect(resolveDirectCallResponse(null, 1, legacy)).toBeNull()
    expect(resolveDirectCallResponse(canonical, 999, legacy)).toBeNull()
    expect(
        resolveDirectCallResponse({ ...canonical, media: { ...canonical.media!, ownershipRevision: 0 } }, 1, legacy)
    ).toBeNull()
})

test("only a server without a canonical snapshot uses the legacy acknowledgement", () => {
    expect(resolveDirectCallResponse(undefined, 1, legacy)).toBe(legacy)
})
