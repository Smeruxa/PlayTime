import { DM_E2EE_PREFIX, isValidE2eeEnvelopeBody } from "./e2eeWire"

export { DM_E2EE_PREFIX }

export function isValidDmE2eeEnvelope(content: string): boolean {
    return isValidE2eeEnvelopeBody(DM_E2EE_PREFIX, content)
}
