import { StrictMode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { CallProps, UserProps } from "../../types"
import { callFromState, type DirectCallState } from "../../utils/directCallState"
import MainLayoutPage from "./MainLayoutPage"

let mockUsers: UserProps[] = []
let mockCall: CallProps | null = null
const mockSetActiveCall = jest.fn()

jest.mock("../../server/socketContext", () => ({
    useSessionSocket: () => ({ socket: null, myName: "player", myUserId: 1, logout: jest.fn() }),
    useCallState: () => ({ activeCall: mockCall, setActiveCall: mockSetActiveCall })
}))
jest.mock("./hooks/useMergedUserLists", () => ({
    useMergedUserLists: (_socket: unknown, setUsers: (users: UserProps[]) => void) => {
        const React = require("react")
        const users = mockUsers
        React.useEffect(() => setUsers(users), [setUsers, users])
        return { listsLoading: false }
    }
}))
jest.mock("./MainLayoutShell", () => ({
    MainLayoutShell: ({
        selected,
        users,
        setUser,
        setSelected
    }: {
        selected: number
        users: UserProps[]
        setUser: (index: number) => void
        setSelected: (index: number) => void
    }) => {
        const { useLocation, useNavigate } = require("react-router-dom")
        const location = useLocation()
        const navigate = useNavigate()
        return (
            <>
                <output data-testid="selected">{users[selected]?.name ?? "all conversations"}</output>
                <output data-testid="selected-index">{selected}</output>
                <output data-testid="route-state">{JSON.stringify(location.state)}</output>
                <button
                    onClick={() => {
                        setUser(-1)
                        setSelected(-1)
                        navigate("/content", { replace: true, state: null })
                    }}
                >
                    All conversations
                </button>
            </>
        )
    }
}))

beforeEach(() => {
    mockUsers = []
    mockCall = null
    mockSetActiveCall.mockClear()
})

test("keeps the conversation list open after going back during a call", () => {
    mockUsers = [{ name: "mira", id: 2, is_room: false }]
    mockCall = { roomId: "call-1", names: ["mira", "player"], incoming: false }
    const view = (
        <StrictMode>
            <MemoryRouter>
                <MainLayoutPage />
            </MemoryRouter>
        </StrictMode>
    )
    const { rerender } = render(view)
    expect(screen.getByTestId("selected")).toHaveTextContent("mira")
    fireEvent.click(screen.getByRole("button", { name: "All conversations" }))
    mockUsers = [...mockUsers]
    mockCall = { ...mockCall, confirmed: true }
    rerender(
        <StrictMode>
            <MemoryRouter>
                <MainLayoutPage />
            </MemoryRouter>
        </StrictMode>
    )
    expect(screen.getByTestId("selected")).toHaveTextContent("all conversations")
})

test("consumes a direct conversation request after the list arrives", () => {
    const view = () => (
        <StrictMode>
            <MemoryRouter initialEntries={[{ pathname: "/content", state: { name: "mira" } }]}>
                <MainLayoutPage />
            </MemoryRouter>
        </StrictMode>
    )
    const { rerender } = render(view())
    expect(screen.getByTestId("selected")).toHaveTextContent("all conversations")
    mockUsers = [{ name: "mira", id: 2, is_room: false }]
    rerender(view())
    expect(screen.getByTestId("selected")).toHaveTextContent("mira")
    expect(screen.getByTestId("route-state")).toHaveTextContent("null")
    fireEvent.click(screen.getByRole("button", { name: "All conversations" }))
    mockUsers = [...mockUsers]
    rerender(view())
    expect(screen.getByTestId("selected")).toHaveTextContent("all conversations")
})

test.each(["caller", "receiver"] as const)(
    "selects the peer without replacing participants when the current user is the %s",
    (role) => {
        mockUsers = [
            { name: "mira", id: 7, is_room: true },
            { name: "player", id: 8, is_room: true },
            { name: "mira", id: 2, is_room: false }
        ]
        const self = { id: 1, username: "player" }
        const peer = { id: 2, username: "mira" }
        const state: DirectCallState = {
            roomId: "1:2:11111111-1111-4111-8111-111111111111",
            status: "in_call",
            revision: 2,
            caller: role === "caller" ? self : peer,
            receiver: role === "receiver" ? self : peer
        }
        mockCall = callFromState(state, self.id)

        render(
            <MemoryRouter>
                <MainLayoutPage />
            </MemoryRouter>
        )

        expect(screen.getByTestId("selected")).toHaveTextContent("mira")
        expect(screen.getByTestId("selected-index")).toHaveTextContent("2")
        expect(mockSetActiveCall).not.toHaveBeenCalled()
        expect(mockCall?.names).toEqual([state.caller.username, state.receiver.username])
    }
)
