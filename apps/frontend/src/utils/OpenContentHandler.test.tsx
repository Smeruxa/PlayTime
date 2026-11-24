import { act, render } from "@testing-library/react"
import OpenContentHandler from "./OpenContentHandler"
import { OPEN_CONTENT_EVENT } from "../platform/notifications"
const mockNavigate = jest.fn()
jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }))
afterEach(() => mockNavigate.mockClear())

test("notification clicks preserve peer identity and reject nickname-only DM targets", () => {
    render(<OpenContentHandler />)
    act(() => window.dispatchEvent(new CustomEvent(OPEN_CONTENT_EVENT, { detail: { name: "SameName", peerUserId: 20 } })))
    expect(mockNavigate).toHaveBeenCalledWith("/content", { state: { name: "SameName", peerUserId: 20 } })
    mockNavigate.mockClear()
    act(() => window.dispatchEvent(new CustomEvent(OPEN_CONTENT_EVENT, { detail: { name: "SameName" } })))
    expect(mockNavigate).not.toHaveBeenCalled()
})
