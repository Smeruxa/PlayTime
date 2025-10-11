import React from "react"
import styles from "./Slider.module.css"

type SliderProps = React.InputHTMLAttributes<HTMLInputElement>

export default function Slider(props: SliderProps) {
    return <input type="range" className={styles.slider} {...props} />
}