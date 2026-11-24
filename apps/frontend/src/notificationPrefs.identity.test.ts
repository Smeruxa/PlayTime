import { isPeerNotifyMuted, togglePeerNotifyMuted } from "./notificationPrefs"

test("mute preferences belong to both account IDs rather than a reusable nickname", () => {
    localStorage.clear()
    expect(togglePeerNotifyMuted(1, 10)).toBe(true)
    expect(isPeerNotifyMuted(1, 10)).toBe(true)
    expect(isPeerNotifyMuted(1, 20)).toBe(false)
    expect(isPeerNotifyMuted(2, 10)).toBe(false)
    expect(togglePeerNotifyMuted(1, 10)).toBe(false)
})
