import { friendPeerId, type FriendItem } from "./types"

const friendship: FriendItem = {
    id: 987,
    user_id: 10,
    friend_id: 20,
    friend_username: "SameName",
    status: "accepted",
    is_room: false
}

test("uses the actual peer account rather than the friendship row or a reused nickname", () => {
    expect(friendPeerId({ ...friendship, other_user_id: 30 }, 10)).toBe(30)
    expect(friendPeerId(friendship, 10)).toBe(20)
    expect(friendPeerId(friendship, 20)).toBe(10)
    expect(friendPeerId(friendship, 40)).toBeNull()
    expect(friendPeerId(friendship)).toBeNull()
})
