import { redis } from "../../shared/config"
import { isUserAccountBlocked } from "./userAccount"

const acctLockedKey = (userId: number) => `acct_locked:${userId}`

export async function assertUserCanAuthenticate(userId: number): Promise<void> {
    if (await isUserAccountBlocked(userId)) {
        throw new Error("account blocked")
    }
    const locked = await redis.exists(acctLockedKey(userId))
    if (locked === 1) {
        throw new Error("account locked")
    }
}
