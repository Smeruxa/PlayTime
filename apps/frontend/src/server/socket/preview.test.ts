import { dmUnreadFromWire, lastPreviewsFromWire, type LastPreviewsWire } from "./preview"

jest.mock("../../features/chat/dmE2ee", () => ({ DM_E2EE_PREFIX: "DM:", getDmSecretKey: jest.fn() }))
jest.mock("../../features/chat/roomE2ee", () => ({ ROOM_E2EE_PREFIX: "ROOM:", loadRoomSymKeyFromStorage: jest.fn() }))
jest.mock("../../features/chat/mediaEncryption", () => ({
    MEDIA_MESSAGE_PREFIX: "MEDIA:",
    decodeMediaMessage: jest.fn()
}))

test("reused names keep separate peer previews and unread counts", () => {
    const data: LastPreviewsWire = {
        dm: { SameName: { from: "SameName", content: "unsafe legacy" } },
        dmUnread: { SameName: 99 },
        dmByUserId: {
            "10": { from: "SameName", content: "archived history" },
            "20": { from: "SameName", content: "new account" }
        },
        dmUnreadByUserId: { "10": 2, "20": 3 },
        rooms: { 5: { from: "SameName", content: "room history" } }
    }
    expect(lastPreviewsFromWire(data, "me", 1)).toEqual({
        "dm-10": { from: "SameName", content: "archived history" },
        "dm-20": { from: "SameName", content: "new account" },
        "room-5": { from: "SameName", content: "room history" }
    })
    expect(dmUnreadFromWire(data)).toEqual({ "10": 2, "20": 3 })
    expect(lastPreviewsFromWire({ dm: data.dm, rooms: {} }, "me", 1)).toEqual({})
    expect(dmUnreadFromWire({ dm: {}, rooms: {}, dmUnread: data.dmUnread })).toEqual({})
})
