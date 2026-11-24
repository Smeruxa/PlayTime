import { fireEvent, render, screen, cleanup } from "@testing-library/react"
import { Modal } from "./Modal"
beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: jest.fn(() => ({ matches: true, addListener: jest.fn(), removeListener: jest.fn() }))
    })
})
afterEach(cleanup)
it("keeps keyboard focus inside the topmost dialog and restores the trigger", () => {
    const trigger = document.createElement("button")
    document.body.append(trigger)
    trigger.focus()
    const close = jest.fn(),
        childClose = jest.fn()
    const { rerender, unmount } = render(
        <Modal title="Parent" onClose={close}>
            <button>Last action</button>
        </Modal>
    )
    const first = screen.getByRole("button", { name: "Закрыть" }),
        last = screen.getByRole("button", { name: "Last action" })
    expect(first).toHaveFocus()
    last.focus()
    fireEvent.keyDown(last, { key: "Tab" })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true })
    expect(last).toHaveFocus()
    rerender(
        <Modal title="Parent" onClose={close}>
            <button>Last action</button>
            <Modal title="Child" onClose={childClose}>
                Child body
            </Modal>
        </Modal>
    )
    fireEvent.keyDown(document.activeElement!, { key: "Escape" })
    expect(childClose).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
    expect(new Set(screen.getAllByRole("dialog").map((el) => el.getAttribute("aria-labelledby"))).size).toBe(2)
    unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
})
