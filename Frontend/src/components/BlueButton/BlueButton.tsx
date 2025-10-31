import styles from "./BlueButton.module.css"

type BlueButtonProps = {
    text: string
    onClick?: () => void
    className?: string
}

export default function BlueButton({ text, onClick, className }: BlueButtonProps) {
    return (
        <button className={`${styles.button65} ${className || ""}`} onClick={onClick}>{text}</button>
    )
}