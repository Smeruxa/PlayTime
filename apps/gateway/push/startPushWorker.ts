import { PushDispatcher } from "./dispatcher"
import { createPushQueue, type CallPushPolicy } from "./repository"
import { readPushConfig, RuStorePushSender } from "./rustore"

export function startPushWorker(allowsRingingPush: CallPushPolicy): (() => void) | null {
    const config = readPushConfig()
    if (!config) {
        return null
    }
    const dispatcher = new PushDispatcher(createPushQueue(allowsRingingPush), new RuStorePushSender(config))
    const tick = () => {
        void dispatcher.flush().catch(() => console.error("Push delivery temporarily unavailable"))
    }
    const timer = setInterval(tick, 1000)
    timer.unref()
    tick()
    return () => clearInterval(timer)
}
