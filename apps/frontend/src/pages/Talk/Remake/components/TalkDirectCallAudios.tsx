import type { MutableRefObject } from "react"
import { publicAssetUrl } from "../../../../utils/publicAssetUrl"

type AudioRefs = {
    callRef: MutableRefObject<HTMLAudioElement | null>
    confirmedRef: MutableRefObject<HTMLAudioElement | null>
    declinedRef: MutableRefObject<HTMLAudioElement | null>
}

export function TalkDirectCallAudios({ audioRefs }: { audioRefs: AudioRefs }) {
    return (
        <>
            <audio ref={audioRefs.declinedRef} src={publicAssetUrl("assets/sounds/declined.mp3")} preload="auto" />
            <audio ref={audioRefs.confirmedRef} src={publicAssetUrl("assets/sounds/confirmed.mp3")} preload="auto" />
            <audio ref={audioRefs.callRef} src={publicAssetUrl("assets/sounds/call.mp3")} preload="auto" />
        </>
    )
}
