import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import EmailVerificationPage from "./EmailVerificationPage"
import { useAccountStatus } from "../../auth/AccountStatus"
import { useSessionSocket } from "../../server/socketContext"

jest.mock("../../auth/AccountStatus", () => ({ useAccountStatus: jest.fn() }))
jest.mock("../../server/socketContext", () => ({ useSessionSocket: jest.fn() }))
jest.mock("../../config", () => ({ API_BASE: "https://api.example.test/playtime" }))
jest.mock("../../ui", () => ({
    Button: jest.requireActual("../../ui/primitives/Button").Button,
    Input: jest.requireActual("../../ui/primitives/Input").Input
}))

const originalFetch = global.fetch
const reloadAccount = jest.fn()
const account = { id: 7, username: "guest", email: "owner@example.test", isGuest: true, registrationPending: true }
const mockFetch = jest.fn()

function mount(entry = "/verify-email?upgrade=1&email=untrusted@example.test") {
    return render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/verify-email" element={<EmailVerificationPage />} />
                <Route path="/content" element={<p>Общение</p>} />
                <Route path="/login" element={<p>Вход</p>} />
                <Route path="/complete-account" element={<p>Изменение почты</p>} />
            </Routes>
        </MemoryRouter>
    )
}

beforeEach(() => {
    jest.resetAllMocks()
    global.fetch = mockFetch
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    reloadAccount.mockResolvedValue(undefined)
    ;(useSessionSocket as jest.Mock).mockReturnValue({ token: "guest-token" })
    ;(useAccountStatus as jest.Mock).mockReturnValue({ account, reloadAccount })
})
afterEach(() => {
    global.fetch = originalFetch
})

test("confirmation requires six digits even when the form is submitted programmatically", async () => {
    mount()
    const input = screen.getByLabelText("Код из письма")
    expect(input).toHaveAttribute("inputmode", "numeric")
    expect(input).toHaveAttribute("maxlength", "6")
    fireEvent.change(input, { target: { value: "01234" } })
    fireEvent.submit(input.closest("form")!)
    expect(await screen.findByText("Введите код из письма: 6 цифр")).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
})

test("guest verification binds both code confirmation and resending to the authenticated account email", async () => {
    const user = userEvent.setup()
    mount()
    const email = screen.getByLabelText("Почта аккаунта")
    expect(email).toHaveValue("owner@example.test")
    expect(email).toHaveAttribute("readonly")
    await user.type(email, "another@example.test")
    expect(email).toHaveValue("owner@example.test")
    await user.click(screen.getByRole("button", { name: "Отправить код ещё раз" }))
    expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://api.example.test/playtime/auth/email-verification/request",
        expect.objectContaining({ body: JSON.stringify({ email: account.email, code: "" }) })
    )
    await user.type(screen.getByLabelText("Код из письма"), "012345")
    await user.click(screen.getByRole("button", { name: "Подтвердить почту" }))
    expect(await screen.findByRole("heading", { name: "Почта подтверждена" })).toBeInTheDocument()
    expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://api.example.test/playtime/auth/email-verification/confirm",
        expect.objectContaining({ body: JSON.stringify({ email: account.email, code: "012345" }) })
    )
    expect(reloadAccount).toHaveBeenCalledTimes(1)
})

test("a consumed confirmation code stays successful if refreshing account status goes offline", async () => {
    reloadAccount.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    mount()
    await user.type(screen.getByLabelText("Код из письма"), "012345")
    await user.click(screen.getByRole("button", { name: "Подтвердить почту" }))
    expect(await screen.findByRole("heading", { name: "Почта подтверждена" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Код из письма")).not.toBeInTheDocument()
    expect(await screen.findByRole("status")).toHaveTextContent("Не удалось обновить статус аккаунта")
    await user.click(screen.getByRole("button", { name: "Обновить статус аккаунта" }))
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument())
    expect(screen.getByRole("heading", { name: "Почта подтверждена" })).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(reloadAccount).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole("button", { name: "Вернуться к общению" }))
    expect(screen.getByText("Общение")).toBeInTheDocument()
})

test("an upgrade never uses the URL email while its account status is still loading", async () => {
    ;(useAccountStatus as jest.Mock).mockReturnValue({ account: null, reloadAccount })
    mount()
    expect(screen.getByLabelText("Почта аккаунта")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Подтвердить почту" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Отправить код ещё раз" }))
    expect(mockFetch).not.toHaveBeenCalled()
})

test("pending guest verification offers authenticated email correction", async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole("button", { name: "Изменить почту" }))
    expect(screen.getByText("Изменение почты")).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
})

test("an invalid code leaves verification available for another attempt", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Неверный или просроченный код" }) })
    const user = userEvent.setup()
    mount()
    await user.type(screen.getByLabelText("Код из письма"), "0000000000")
    await user.click(screen.getByRole("button", { name: "Подтвердить почту" }))
    expect(await screen.findByRole("status")).toHaveTextContent("Неверный или просроченный код")
    expect(screen.getByRole("heading", { name: "Подтвердите почту" })).toBeInTheDocument()
    expect(screen.getByLabelText("Код из письма")).toBeEnabled()
    expect(reloadAccount).not.toHaveBeenCalled()
})

test("ordinary email verification keeps the editable email and returns to sign-in", async () => {
    ;(useSessionSocket as jest.Mock).mockReturnValue({ token: null })
    const user = userEvent.setup()
    mount("/verify-email?email=first@example.test")
    const email = screen.getByLabelText("Почта аккаунта")
    expect(email).not.toHaveAttribute("readonly")
    await user.clear(email)
    await user.type(email, "second@example.test")
    await user.type(screen.getByLabelText("Код из письма"), "012345")
    await user.click(screen.getByRole("button", { name: "Подтвердить почту" }))
    expect(await screen.findByRole("heading", { name: "Почта подтверждена" })).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/confirm"),
        expect.objectContaining({ body: JSON.stringify({ email: "second@example.test", code: "012345" }) })
    )
    expect(reloadAccount).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Перейти ко входу" }))
    expect(screen.getByText("Вход")).toBeInTheDocument()
})
