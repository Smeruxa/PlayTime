import { type EffectCallback, useEffect, useState } from "react"

export function useMount(effect: EffectCallback) {
    const [mountEffect] = useState(() => effect)
    useEffect(() => mountEffect(), [mountEffect])
}
