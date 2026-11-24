import { ROOM_E2EE_PREFIX, isValidE2eeEnvelopeBody } from "./e2eeWire"

export { ROOM_E2EE_PREFIX }

export function isValidRoomE2eeEnvelope(content: string): boolean {
    return isValidE2eeEnvelopeBody(ROOM_E2EE_PREFIX, content)
}
