import React from "react"
import styles from "./SubscribeButton.module.css"

interface ButtonProps {
    text?: string
    onClick?: () => void
    className?: string
}

const Button: React.FC<ButtonProps> = ({ text = "Донат", onClick, className }) => {
    return <button className={`${styles.Btn} ${className ?? ""}`} onClick={onClick} data-text={text}>{text}</button>
}

export default Button