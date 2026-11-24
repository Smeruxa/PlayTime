import {
    browserNotificationPermission,
    notifyMessage,
    OPEN_CONTENT_EVENT,
    requestBrowserNotifications
} from "./notifications"

const originalNotification = window.Notification
const originalApi = window.electronAPI
const originalSecure = window.isSecureContext
const requestPermission = jest.fn()
const close = jest.fn()
let shown: { title: string; options: NotificationOptions; onclick?: () => void; close: () => void }[]

beforeEach(() => {
    shown = []
    requestPermission.mockReset()
    close.mockReset()
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true })
    window.electronAPI = undefined as unknown as Window["electronAPI"]
    window.Notification = class {
        static permission = "default"
        static requestPermission = requestPermission
        close = close
        constructor(
            public title: string,
            public options: NotificationOptions
        ) {
            shown.push(this)
        }
    } as unknown as typeof Notification
})
afterEach(() => {
    window.Notification = originalNotification
    window.electronAPI = originalApi
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: originalSecure })
    jest.restoreAllMocks()
})

test("receiving messages never requests browser notification permission", () => {
    notifyMessage({ name: "alex", text: "hello" })
    expect(shown).toHaveLength(0)
    expect(requestPermission).not.toHaveBeenCalled()
})

test("the settings permission action asks once only when a prompt can be shown", async () => {
    requestPermission.mockResolvedValue("granted")
    expect(await requestBrowserNotifications()).toBe("granted")
    expect(requestPermission).toHaveBeenCalledTimes(1)
    Object.defineProperty(Notification, "permission", { value: "denied" })
    expect(await requestBrowserNotifications()).toBe("denied")
    expect(requestPermission).toHaveBeenCalledTimes(1)
})

test("notifications open the matching room and close after a click", () => {
    Object.defineProperty(Notification, "permission", { value: "granted" })
    const focus = jest.spyOn(window, "focus").mockImplementation(() => {})
    const open = jest.fn()
    window.addEventListener(OPEN_CONTENT_EVENT, open)
    const target = { name: "Gaming", text: "hello", isRoom: true, roomId: 42, roomName: "Gaming" }
    notifyMessage(target)
    expect(shown[0].options.tag).toBe("playtime-room-42")
    shown[0].onclick?.()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0].detail).toEqual(target)
    window.removeEventListener(OPEN_CONTENT_EVENT, open)
})

test("Electron keeps its native notifications", () => {
    const sendNotification = jest.fn()
    window.electronAPI = { sendNotification } as unknown as Window["electronAPI"]
    notifyMessage({ name: "alex", text: "hello" })
    expect(sendNotification).toHaveBeenCalledWith({ name: "alex", text: "hello" })
    expect(shown).toHaveLength(0)
})

test("insecure contexts and missing notification support are handled without throwing", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false })
    expect(browserNotificationPermission()).toBe("unsupported")
    expect(await requestBrowserNotifications()).toBe("unsupported")
    window.Notification = undefined as unknown as typeof Notification
    expect(() => notifyMessage({ name: "alex", text: "hello" })).not.toThrow()
})

test("DM notification grouping and click targets distinguish accounts with the same nickname", () => {
    Object.defineProperty(Notification, "permission", { value: "granted" })
    jest.spyOn(window, "focus").mockImplementation(() => {})
    const open = jest.fn()
    window.addEventListener(OPEN_CONTENT_EVENT, open)
    notifyMessage({ name: "SameName", peerUserId: 10, text: "old account" })
    notifyMessage({ name: "SameName", peerUserId: 20, text: "new account" })
    expect(shown.map((notification) => notification.options.tag)).toEqual(["playtime-dm-10", "playtime-dm-20"])
    shown[1].onclick?.()
    expect(open.mock.calls[0][0].detail.peerUserId).toBe(20)
    window.removeEventListener(OPEN_CONTENT_EVENT, open)
})
