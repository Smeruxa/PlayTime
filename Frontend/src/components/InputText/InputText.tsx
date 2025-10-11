"use client"
import { useState, useRef } from "react"
import "./InputText.scss"

interface InputTextProps {
    showToggle?: boolean
    bgColor?: string
    textColor?: string
    valueColor?: string
    placeholder?: string
    id?: string
    onChange?: (value: string) => void
}

export default function InputText({
    showToggle = true,
    bgColor = "#353535",
    textColor = "#fdfdfd",
    valueColor = "#fdfdfd",
    placeholder = "Enter password",
    id = "password",
    onChange
}: InputTextProps) {
    const [visible, setVisible] = useState(false)
    const [value, setValue] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)
    const rippleRef = useRef<HTMLDivElement>(null)
    const toggleRef = useRef<HTMLDivElement>(null)

    const handleClick = () => {
        if (!showToggle) return
        rippleRef.current?.classList.add("animate")
        inputRef.current?.classList.add("animate")
        if (inputRef.current) {
            inputRef.current.type = inputRef.current.type === "text" ? "password" : "text"
        }
        setVisible(inputRef.current?.type === "text" ? false : true)
    }

    const removeAnimate = () => {
        rippleRef.current?.classList.remove("animate")
        inputRef.current?.classList.remove("animate")
        if (toggleRef.current) toggleRef.current.style.pointerEvents = "all"
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setValue(e.target.value)
        onChange?.(e.target.value)
    }

    return (
        <div className="container" style={{ width: "100%" }}>
            <div className="ripple" ref={rippleRef} onAnimationEnd={removeAnimate}></div>
            {showToggle && (
                <div
                    className="toggle"
                    data-state={visible ? "visible" : "hidden"}
                    onClick={handleClick}
                    ref={toggleRef}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="eye" width="32" height="32">
                        <circle cx="16" cy="15" r="3"/>
                        <path d="M30 16s-6.268 7-14 7-14-7-14-7 6.268-7 14-7 14 7 14 7zM22.772 10.739a8 8 0 1 1-13.66.189"/>
                    </svg>
                </div>
            )}
            <input
                type={showToggle ? (visible ? "text" : "password") : "text"}
                id={id}
                placeholder={placeholder}
                autoComplete="off"
                ref={inputRef}
                value={value}
                onChange={handleChange}
                style={{
                    backgroundColor: bgColor,
                    color: valueColor,
                    "--placeholder-color": textColor,
                    paddingRight: showToggle ? "80px" : "30px"
                } as any}
            />
            <label htmlFor={id}></label>
        </div>
    )
}