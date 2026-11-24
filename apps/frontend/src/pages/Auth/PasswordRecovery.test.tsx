import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PasswordRecovery } from "./PasswordRecovery"

jest.mock("../../config", () => ({ API_BASE: "https://api.example.test/playtime" }))

const originalFetch = global.fetch
const request = jest.fn()

beforeEach(() => {
    request.mockReset()
    request.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    global.fetch = request
})

afterEach(() => {
    global.fetch = originalFetch
})

test("password recovery sends a six-digit code with its leading zero intact", async () => {
    const user = userEvent.setup()
    render(<PasswordRecovery onBack={jest.fn()} />)
    await user.type(screen.getByLabelText("Почта аккаунта"), "member@example.test")
    await user.click(screen.getByRole("button", { name: "Отправить код" }))
    const input = await screen.findByLabelText("Код из письма · 6 цифр")
    expect(input).toHaveAttribute("inputmode", "numeric")
    await user.type(input, "012345")
    await user.type(screen.getByLabelText("Новый пароль · от 12 до 50 символов"), "SecurePassword2026!")
    await user.type(screen.getByLabelText("Повторите новый пароль"), "SecurePassword2026!")
    await user.click(screen.getByRole("button", { name: "Изменить пароль" }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({ code: "012345" })
    expect(await screen.findByRole("status")).toHaveTextContent("Пароль изменён")
})

test("an invalid confirmation does not reach the password-reset API", async () => {
    render(<PasswordRecovery onBack={jest.fn()} />)
    fireEvent.change(screen.getByLabelText("Почта аккаунта"), { target: { value: "member@example.test" } })
    fireEvent.submit(screen.getByRole("button", { name: "Отправить код" }).closest("form")!)
    const input = await screen.findByLabelText("Код из письма · 6 цифр")
    fireEvent.change(input, { target: { value: "01234" } })
    fireEvent.submit(input.closest("form")!)
    expect(await screen.findByRole("status")).toHaveTextContent("6 цифр")
    expect(request).toHaveBeenCalledTimes(1)
})
