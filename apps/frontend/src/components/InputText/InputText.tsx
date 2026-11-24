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

    const handleClick = () => {
        if (!showToggle) return
        if (inputRef.current) {
            inputRef.current.type = inputRef.current.type === "text" ? "password" : "text"
        }
        setVisible(inputRef.current?.type === "text" ? false : true)
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setValue(e.target.value)
        onChange?.(e.target.value)
    }

    return (
        <div className="ptInputContainer" style={{ width: "100%" }}>
            <input
                type={showToggle ? (visible ? "text" : "password") : "text"}
                id={id}
                placeholder={placeholder}
                autoComplete="off"
                ref={inputRef}
                value={value}
                onChange={handleChange}
                className="ptInput"
                style={
                    {
                        backgroundColor: bgColor,
                        color: valueColor,
                        "--placeholder-color": textColor,
                        paddingRight: showToggle ? "44px" : "12px"
                    } as any
                }
            />
            {showToggle && (
                <button
                    type="button"
                    className="ptToggle"
                    onClick={handleClick}
                    aria-label={visible ? "Hide password" : "Show password"}
                    title={visible ? "Hide" : "Show"}
                >
                    <svg viewBox="0 0 24 24" className="ptEye" aria-hidden="true">
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                    </svg>
                </button>
            )}
        </div>
    )
}
