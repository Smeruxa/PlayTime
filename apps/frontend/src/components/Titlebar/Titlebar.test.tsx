import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import Titlebar from "./Titlebar"
import type { UpdateState } from "../../hooks/useAppUpdate"

let listener: (channel: string, payload: Record<string, unknown>) => void
const originalApi = window.electronAPI
const installUpdate = jest.fn(async () => ({ ok: true }))
const openUpdateDownload = jest.fn(async () => ({ ok: true }))

beforeEach(() => {
    jest.clearAllMocks()
    window.electronAPI = {
        installUpdate,
        openUpdateDownload,
        getUpdateState: async () => ({ kind: "idle" }),
        onUpdateEvent: (callback: Parameters<NonNullable<Window["electronAPI"]>["onUpdateEvent"]>[0]) => {
            listener = callback
            return () => {}
        }
    } as unknown as NonNullable<Window["electronAPI"]>
})
afterEach(() => {
    window.electronAPI = originalApi
})
const emit = (state: UpdateState) => act(() => listener("update:state", state))

test("a browser does not display desktop window controls", () => {
    window.electronAPI = undefined as unknown as Window["electronAPI"]
    const { container } = render(<Titlebar />)
    expect(container).toBeEmptyDOMElement()
})

test("restart stays hidden until native preparation completes and errors replace it", async () => {
    render(<Titlebar />)
    emit({ kind: "preparing", version: "2.0.12" })
    expect(screen.getByRole("status")).toHaveTextContent("Подготовка обновления")
    expect(screen.queryByRole("button", { name: /Перезапустить/ })).not.toBeInTheDocument()
    emit({ kind: "downloaded", version: "2.0.12" })
    fireEvent.click(screen.getByRole("button", { name: "Перезапустить (2.0.12)" }))
    await waitFor(() => expect(installUpdate).toHaveBeenCalledTimes(1))
    emit({ kind: "error", version: "2.0.12", message: "Invalid signature" })
    expect(screen.getByRole("alert")).toHaveTextContent("Обновление не установлено")
    expect(screen.queryByRole("button", { name: /Перезапустить/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Скачать обновление" }))
    await waitFor(() => expect(openUpdateDownload).toHaveBeenCalledTimes(1))
})

test("manual macOS updates open the download page and never trigger restart", async () => {
    render(<Titlebar />)
    emit({ kind: "manual", version: "2.0.12" })
    fireEvent.click(screen.getByRole("button", { name: "Скачать (2.0.12)" }))
    await waitFor(() => expect(openUpdateDownload).toHaveBeenCalledTimes(1))
    expect(installUpdate).not.toHaveBeenCalled()
})

test("failed IPC does not leave a restart button or unhandled rejection", async () => {
    installUpdate.mockRejectedValueOnce(new Error("IPC disconnected"))
    render(<Titlebar />)
    emit({ kind: "downloaded", version: "2.0.12" })
    fireEvent.click(screen.getByRole("button", { name: "Перезапустить (2.0.12)" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Обновление не установлено")
})

test("a late state snapshot cannot overwrite a newer updater event", async () => {
    let resolve: (state: UpdateState) => void = () => {}
    window.electronAPI!.getUpdateState = () =>
        new Promise((done) => {
            resolve = done
        })
    render(<Titlebar />)
    emit({ kind: "manual", version: "2.0.12" })
    await act(async () => resolve({ kind: "idle" }))
    expect(screen.getByRole("button", { name: "Скачать (2.0.12)" })).toBeInTheDocument()
})
