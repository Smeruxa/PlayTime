import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import App from "./App"

test("offers browser entry methods and opens the existing sign-in form", async () => {
    localStorage.clear()
    render(
        <MemoryRouter>
            <App />
        </MemoryRouter>
    )
    expect(await screen.findByRole("button", { name: /Войти по нику/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Создать аккаунт/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Войти в аккаунт" }))
    expect(await screen.findByRole("button", { name: "Войти" })).toBeInTheDocument()
    expect(screen.getByLabelText("Почта")).toBeInTheDocument()
    expect(screen.getByLabelText("Пароль")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Зарегистрироваться" })).toBeInTheDocument()
})

test("preserves a direct email verification link on a fresh visit", async () => {
    localStorage.clear()
    render(
        <MemoryRouter initialEntries={["/verify-email?email=player%40example.test"]}>
            <App />
        </MemoryRouter>
    )
    expect(await screen.findByRole("heading", { name: "Подтвердите почту" })).toBeInTheDocument()
    expect(screen.getByLabelText("Почта аккаунта")).toHaveValue("player@example.test")
})

test("does not render the app shell without a session", async () => {
    localStorage.clear()
    render(
        <MemoryRouter initialEntries={["/friends"]}>
            <App />
        </MemoryRouter>
    )
    expect(await screen.findByRole("button", { name: /Войти по нику/ })).toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
})
