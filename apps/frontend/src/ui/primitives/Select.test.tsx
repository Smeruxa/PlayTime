import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { Modal } from "../overlays/Modal"
import { Select, type SelectOption } from "./Select"

const options: SelectOption[] = [
    { value: "alpha", label: "Alpha" },
    { value: "beta", label: "Beta", disabled: true },
    { value: "bravo", label: "Bravo" },
    { value: "zulu", label: "Zulu" }
]
const originalMatchMedia = window.matchMedia
beforeEach(() => {
    window.matchMedia = jest.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia
})
afterEach(() => {
    window.matchMedia = originalMatchMedia
})

function Controlled({ changed = jest.fn() }: { changed?: (value: string) => void }) {
    const [value, setValue] = useState("alpha")
    return (
        <>
            <label htmlFor="device">Device</label>
            <Select
                id="device"
                options={options}
                value={value}
                onChange={(next) => {
                    changed(next)
                    setValue(next)
                }}
            />
        </>
    )
}
function active() {
    return document.getElementById(screen.getByRole("combobox").getAttribute("aria-activedescendant")!)
}

test("mouse selection is controlled, selected options are exposed, and focus stays on the trigger", () => {
    const changed = jest.fn()
    render(<Controlled changed={changed} />)
    const trigger = screen.getByRole("combobox", { name: "Device" })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole("listbox").parentElement).toBe(document.body)
    expect(screen.getByRole("option", { name: "Alpha" })).toHaveAttribute("aria-selected", "true")
    const disabled = screen.getByRole("option", { name: "Beta" })
    expect(disabled).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(disabled)
    expect(changed).not.toHaveBeenCalled()
    const zulu = screen.getByRole("option", { name: "Zulu" })
    fireEvent.pointerDown(zulu)
    fireEvent.click(zulu)
    expect(changed).toHaveBeenCalledWith("zulu")
    expect(trigger).toHaveTextContent("Zulu")
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
})

test("arrows skip disabled options; Home, End, Enter and typeahead keep the controlled value", () => {
    const changed = jest.fn()
    render(<Controlled changed={changed} />)
    const trigger = screen.getByRole("combobox")
    trigger.focus()
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    expect(active()).toHaveTextContent("Alpha")
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    expect(active()).toHaveTextContent("Bravo")
    fireEvent.keyDown(trigger, { key: "Home" })
    expect(active()).toHaveTextContent("Alpha")
    fireEvent.keyDown(trigger, { key: "End" })
    expect(active()).toHaveTextContent("Zulu")
    fireEvent.keyDown(trigger, { key: "Enter" })
    expect(changed).toHaveBeenLastCalledWith("zulu")
    fireEvent.keyDown(trigger, { key: "b" })
    fireEvent.keyDown(trigger, { key: "r" })
    expect(active()).toHaveTextContent("Bravo")
    fireEvent.keyDown(trigger, { key: "Enter" })
    expect(changed).toHaveBeenLastCalledWith("bravo")
    expect(trigger).toHaveTextContent("Bravo")
})

test("Escape closes only the dropdown before the modal's document capture handler", () => {
    const close = jest.fn()
    render(
        <Modal title="Settings" onClose={close}>
            <Controlled />
        </Modal>
    )
    const trigger = screen.getByRole("combobox")
    trigger.focus()
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    fireEvent.keyDown(trigger, { key: "Escape" })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(close).not.toHaveBeenCalled()
    fireEvent.keyDown(trigger, { key: "Escape" })
    expect(close).toHaveBeenCalledTimes(1)
})

test("Tab closes the dropdown and leaves the modal's focus trap in control", () => {
    const close = jest.fn()
    render(
        <Modal title="Settings" onClose={close}>
            <Controlled />
        </Modal>
    )
    const trigger = screen.getByRole("combobox")
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: "Tab" })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Закрыть" })).toHaveFocus()
    expect(close).not.toHaveBeenCalled()
})

test("outside pointer dismissal does not change the value or steal the outside target's focus", () => {
    const changed = jest.fn()
    render(
        <>
            <Controlled changed={changed} />
            <button>Outside</button>
        </>
    )
    const trigger = screen.getByRole("combobox")
    trigger.focus()
    fireEvent.click(trigger)
    const outside = screen.getByRole("button", { name: "Outside" })
    fireEvent.pointerDown(outside)
    outside.focus()
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
    expect(changed).not.toHaveBeenCalled()
})

test("the body portal flips above the trigger and clamps a long device list to a short viewport", () => {
    const width = window.innerWidth,
        height = window.innerHeight
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 160 })
    try {
        render(
            <Select
                aria-label="Devices"
                value="0"
                options={Array.from({ length: 30 }, (_, index) => ({ value: String(index), label: `Device ${index}` }))}
                onChange={() => {}}
            />
        )
        const trigger = screen.getByRole("combobox")
        jest.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
            left: 270,
            right: 390,
            top: 110,
            bottom: 146,
            width: 120,
            height: 36,
            x: 270,
            y: 110,
            toJSON() {}
        })
        fireEvent.click(trigger)
        const list = screen.getByRole("listbox")
        expect(list.style.top).toBe("8px")
        expect(parseFloat(list.style.left)).toBeGreaterThanOrEqual(8)
        expect(parseFloat(list.style.left) + parseFloat(list.style.width)).toBeLessThanOrEqual(312)
        expect(parseFloat(list.style.maxHeight)).toBe(98)
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 240 })
        fireEvent(window, new Event("resize"))
        expect(parseFloat(list.style.left) + parseFloat(list.style.width)).toBeLessThanOrEqual(232)
    } finally {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
        Object.defineProperty(window, "innerHeight", { configurable: true, value: height })
    }
})

test("device updates replace a removed active option and an empty list closes without changing the stored value", () => {
    const changed = jest.fn()
    const { rerender } = render(<Select value="alpha" options={options} onChange={changed} />)
    const trigger = screen.getByRole("combobox")
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    expect(active()).toHaveTextContent("Bravo")
    rerender(<Select value="alpha" options={[options[0]]} onChange={changed} />)
    expect(active()).toHaveTextContent("Alpha")
    rerender(<Select value="alpha" options={[]} onChange={changed} />)
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(trigger).toBeDisabled()
    expect(changed).not.toHaveBeenCalled()
})

test("scrollbar pointer focus inside the portal keeps the popup open and restores trigger focus", () => {
    render(<Controlled />)
    const trigger = screen.getByRole("combobox")
    trigger.focus()
    fireEvent.click(trigger)
    const list = screen.getByRole("listbox")
    list.tabIndex = -1
    fireEvent.pointerDown(list)
    list.focus()
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    const frame = jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        callback(0)
        return 1
    })
    try {
        fireEvent.pointerUp(window)
        expect(trigger).toHaveFocus()
        expect(active()).toHaveTextContent("Alpha")
        expect(screen.getByRole("listbox")).toBeInTheDocument()
    } finally {
        frame.mockRestore()
    }
})
