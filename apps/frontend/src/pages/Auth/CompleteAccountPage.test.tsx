import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import CompleteAccountPage from "./CompleteAccountPage"
import { useAccountStatus } from "../../auth/AccountStatus"
import { useSessionSocket } from "../../server/socketContext"

jest.mock("../../auth/AccountStatus", () => ({ useAccountStatus: jest.fn() }))
jest.mock("../../server/socketContext", () => ({ useSessionSocket: jest.fn() }))
jest.mock("../../config", () => ({ API_BASE: "https://api.example.test/playtime" }))
jest.mock("../../ui", () => ({
    Button: jest.requireActual("../../ui/primitives/Button").Button,
    Input: jest.requireActual("../../ui/primitives/Input").Input,
    Checkbox: jest.requireActual("../../ui/primitives/Checkbox").Checkbox
}))

const originalFetch = global.fetch
const mockFetch = jest.fn()
const reloadAccount = jest.fn()
const account = { id: 7, username: "guest", email: "typo@example.test", isGuest: true, registrationPending: true }
function VerificationTarget() {
    const location = useLocation()
    return <p>Подтверждение{location.search}</p>
}
function mount(path = "/complete-account?change-email=1") {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/complete-account" element={<CompleteAccountPage />} />
                <Route path="/verify-email" element={<VerificationTarget />} />
                <Route path="/content" element={<p>Общение</p>} />
            </Routes>
        </MemoryRouter>
    )
}
beforeEach(() => {
    jest.resetAllMocks()
    global.fetch = mockFetch
    mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ user: { ...account, email: "correct@example.test" }, verificationRequired: true })
    })
    reloadAccount.mockResolvedValue(undefined)
    ;(useAccountStatus as jest.Mock).mockReturnValue({ account, reloadAccount })
    ;(useSessionSocket as jest.Mock).mockReturnValue({ token: "guest-token" })
})
afterEach(() => {
    global.fetch = originalFetch
})

async function fillCorrection() {
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Новая почта"), "correct@example.test")
    await user.type(screen.getByLabelText("Пароль аккаунта"), "chosen-password-2026")
    await user.click(screen.getByRole("button", { name: "Изменить почту" }))
    return user
}

test("a pending guest can reach email correction and confirms with the chosen password", async () => {
    const user = userEvent.setup()
    mount("/complete-account")
    await user.click(screen.getByRole("button", { name: "Изменить почту" }))
    expect(screen.getByRole("heading", { name: "Изменить почту" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Повторите пароль")).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    await fillCorrection()
    expect(await screen.findByText("Подтверждение?upgrade=1&email=correct%40example.test")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/playtime/auth/guest/change-email",
        expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer guest-token" },
            body: JSON.stringify({ email: "correct@example.test", password: "chosen-password-2026" })
        })
    )
    expect(reloadAccount).toHaveBeenCalledTimes(1)
})

test("a wrong password remains actionable without advancing to verification", async () => {
    mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Неверный пароль. Введите пароль, выбранный при регистрации." })
    })
    mount()
    await fillCorrection()
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный пароль")
    expect(screen.getByLabelText("Пароль аккаунта")).toBeEnabled()
    expect(screen.getByLabelText("Новая почта")).toHaveValue("correct@example.test")
    expect(reloadAccount).not.toHaveBeenCalled()
})

test("an offline status refresh after saving never resubmits the email mutation", async () => {
    reloadAccount.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined)
    mount()
    const user = await fillCorrection()
    expect(await screen.findByRole("alert")).toHaveTextContent("Данные сохранены")
    expect(screen.queryByLabelText("Пароль аккаунта")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Продолжить подтверждение" }))
    expect(await screen.findByText("Подтверждение?upgrade=1&email=correct%40example.test")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(reloadAccount).toHaveBeenCalledTimes(2)
})

test("an unregistered guest still needs the full registration form even with a correction URL", async () => {
    ;(useAccountStatus as jest.Mock).mockReturnValue({
        account: { ...account, email: null, registrationPending: false },
        reloadAccount
    })
    mount()
    expect(screen.getByRole("heading", { name: "Сохраните свой аккаунт" })).toBeInTheDocument()
    expect(screen.getByLabelText("Повторите пароль")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Зарегистрировать аккаунт" })).toBeDisabled()
    await waitFor(() => expect(mockFetch).not.toHaveBeenCalled())
})
