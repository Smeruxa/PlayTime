import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import styles from "./Select.module.css"

export type SelectOption = { value: string; label: string; disabled?: boolean }

type SelectProps = {
    id?: string
    value: string
    options: readonly SelectOption[]
    onChange: (value: string) => void
    disabled?: boolean
    placeholder?: string
    className?: string
    "aria-label"?: string
    "aria-labelledby"?: string
}

export function Select({
    id,
    value,
    options,
    onChange,
    disabled = false,
    placeholder = "Выберите вариант",
    className,
    "aria-label": label,
    "aria-labelledby": labelledBy
}: SelectProps) {
    const generatedId = useId()
    const triggerId = id ?? generatedId
    const listId = `${triggerId}-options`
    const trigger = useRef<HTMLButtonElement>(null)
    const list = useRef<HTMLDivElement>(null)
    const pointerInList = useRef(false)
    const search = useRef({ text: "", at: 0 })
    const [open, setOpen] = useState(false)
    const [activeValue, setActiveValue] = useState<string | null>(null)
    const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 0 })
    const selected = options.find((option) => option.value === value)
    const available = !disabled && options.some((option) => !option.disabled)
    const activeIndex = options.findIndex((option) => option.value === activeValue && !option.disabled)
    const activeId = activeIndex < 0 ? undefined : `${listId}-${activeIndex}`
    const close = useCallback(() => {
        pointerInList.current = false
        setOpen(false)
        search.current = { text: "", at: 0 }
    }, [])

    const place = useCallback(() => {
        const rect = trigger.current?.getBoundingClientRect()
        if (!rect) return
        const viewport = window.visualViewport
        const leftEdge = (viewport?.offsetLeft ?? 0) + 8
        const topEdge = (viewport?.offsetTop ?? 0) + 8
        const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16
        const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16
        const width = Math.max(0, Math.min(Math.max(rect.width, 180), rightEdge - leftEdge))
        const desiredHeight = Math.min(280, Math.max(1, options.length) * 36 + 10)
        const below = Math.max(0, bottomEdge - rect.bottom - 4)
        const above = Math.max(0, rect.top - topEdge - 4)
        const down = below >= Math.min(desiredHeight, 160) || below >= above
        const maxHeight = Math.min(desiredHeight, down ? below : above, Math.max(0, bottomEdge - topEdge))
        const preferredTop = down ? rect.bottom + 4 : rect.top - 4 - maxHeight
        setPosition({
            left: Math.max(leftEdge, Math.min(rect.left, rightEdge - width)),
            top: Math.max(topEdge, Math.min(preferredTop, bottomEdge - maxHeight)),
            width,
            maxHeight
        })
    }, [options.length])

    useLayoutEffect(() => {
        if (!open) return
        if (!available) {
            close()
            return
        }
        if (activeIndex < 0)
            setActiveValue(
                options.find((option) => option.value === value && !option.disabled)?.value ??
                    options.find((option) => !option.disabled)!.value
            )
    }, [open, available, activeIndex, options, value, close])

    useLayoutEffect(() => {
        if (!open) return
        place()
        const reposition = (event: Event) => {
            if (event.target instanceof Node && list.current?.contains(event.target)) return
            place()
        }
        window.addEventListener("resize", reposition)
        window.addEventListener("scroll", reposition, true)
        window.visualViewport?.addEventListener("resize", reposition)
        window.visualViewport?.addEventListener("scroll", reposition)
        return () => {
            window.removeEventListener("resize", reposition)
            window.removeEventListener("scroll", reposition, true)
            window.visualViewport?.removeEventListener("resize", reposition)
            window.visualViewport?.removeEventListener("scroll", reposition)
        }
    }, [open, place])

    useLayoutEffect(() => {
        if (open && activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" })
    }, [open, activeId])

    useEffect(() => {
        if (!open) return
        const escape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== "Escape") return
            event.preventDefault()
            event.stopPropagation()
            close()
            trigger.current?.focus()
        }
        let restoreFocusFrame: number | undefined
        const outside = (event: PointerEvent) => {
            pointerInList.current = event.target instanceof Node && !!list.current?.contains(event.target)
            if (
                event.target instanceof Node &&
                !trigger.current?.contains(event.target) &&
                !list.current?.contains(event.target)
            )
                close()
        }
        const finishPointer = () => {
            if (!pointerInList.current) return
            pointerInList.current = false
            restoreFocusFrame = requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
        }
        window.addEventListener("keydown", escape, true)
        window.addEventListener("pointerdown", outside, true)
        window.addEventListener("pointerup", finishPointer, true)
        window.addEventListener("pointercancel", finishPointer, true)
        return () => {
            window.removeEventListener("keydown", escape, true)
            window.removeEventListener("pointerdown", outside, true)
            window.removeEventListener("pointerup", finishPointer, true)
            window.removeEventListener("pointercancel", finishPointer, true)
            if (restoreFocusFrame !== undefined) cancelAnimationFrame(restoreFocusFrame)
        }
    }, [open, close])

    const show = (last = false) => {
        if (!available) return
        const enabled = options.filter((option) => !option.disabled)
        setActiveValue(
            enabled.find((option) => option.value === value)?.value ?? enabled[last ? enabled.length - 1 : 0].value
        )
        search.current = { text: "", at: 0 }
        place()
        setOpen(true)
    }
    const choose = (option: SelectOption) => {
        if (option.disabled) return
        close()
        trigger.current?.focus()
        if (option.value !== value) onChange(option.value)
    }
    const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "Tab") {
            close()
            return
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault()
            const enabled = options.filter((option) => !option.disabled)
            if (!enabled.length) return
            if (!open) show(event.key === "ArrowUp" || event.key === "End")
            const index = enabled.findIndex((option) => option.value === activeValue)
            if (event.key === "Home" || event.key === "End")
                setActiveValue(enabled[event.key === "Home" ? 0 : enabled.length - 1].value)
            else if (open)
                setActiveValue(
                    enabled[(index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length].value
                )
        } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            if (open && activeIndex >= 0) choose(options[activeIndex])
            else show()
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault()
            const now = Date.now()
            const text = (now - search.current.at < 700 ? search.current.text : "") + event.key.toLocaleLowerCase()
            const repeated = Array.from(text).every((character) => character === text[0])
            const query = repeated ? text[0] : text
            const start = open && !repeated ? activeIndex : activeIndex + 1
            for (let offset = 0; offset < options.length; offset++) {
                const option = options[(Math.max(0, start) + offset) % options.length]
                if (!option.disabled && option.label.toLocaleLowerCase().startsWith(query)) {
                    if (!open) show()
                    setActiveValue(option.value)
                    break
                }
            }
            search.current = { text, at: now }
        }
    }

    return (
        <>
            <button
                ref={trigger}
                id={triggerId}
                type="button"
                role="combobox"
                aria-label={label}
                aria-labelledby={labelledBy}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-activedescendant={open ? activeId : undefined}
                disabled={!available}
                className={[styles.trigger, className].filter(Boolean).join(" ")}
                onClick={() => (open ? close() : show())}
                onKeyDown={keyDown}
                onBlur={(event) => {
                    if (
                        pointerInList.current ||
                        (event.relatedTarget instanceof Node && list.current?.contains(event.relatedTarget))
                    )
                        return
                    close()
                }}
            >
                <span className={styles.value}>{selected?.label ?? placeholder}</span>
                <svg className={styles.arrow} viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 6 4 4 4-4" />
                </svg>
            </button>
            {open &&
                createPortal(
                    <div
                        ref={list}
                        id={listId}
                        role="listbox"
                        aria-labelledby={labelledBy ?? triggerId}
                        className={styles.list}
                        style={position}
                    >
                        {options.map((option, index) => (
                            <div
                                key={option.value}
                                id={`${listId}-${index}`}
                                role="option"
                                aria-selected={option.value === value}
                                aria-disabled={option.disabled || undefined}
                                className={[styles.option, activeValue === option.value ? styles.active : ""]
                                    .filter(Boolean)
                                    .join(" ")}
                                title={option.label}
                                onPointerDown={(event) => event.preventDefault()}
                                onPointerMove={() => !option.disabled && setActiveValue(option.value)}
                                onClick={() => choose(option)}
                            >
                                <span className={styles.optionLabel}>{option.label}</span>
                                <span aria-hidden="true">{option.value === value ? "✓" : ""}</span>
                            </div>
                        ))}
                    </div>,
                    document.body
                )}
        </>
    )
}
