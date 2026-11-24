import React from "react"
import styles from "./Slider.module.css"

type SliderProps = React.InputHTMLAttributes<HTMLInputElement>

export default function Slider({ className, ...props }: SliderProps) {
    const merged = [styles.slider, className].filter(Boolean).join(" ")
    return <input type="range" className={merged} {...props} />
}
