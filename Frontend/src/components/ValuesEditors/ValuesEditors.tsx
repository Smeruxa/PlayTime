import { useState, useEffect } from "react"
import styles from "./ValuesEditors.module.css"
import Slider from "../../components/Slider/Slider"

export default function ValuesEditors() {
    const [valueMic, setValueMic] = useState(() => {
        const saved = localStorage.getItem("valueMic");
        return saved !== null ? Number(saved) : 0;
    });
    const [valueSound, setValueSound] = useState(() => {
        const saved = localStorage.getItem("valueSound");
        return saved !== null ? Number(saved) : 0;
    });

    useEffect(() => {
        localStorage.setItem("valueMic", valueMic.toString());
        localStorage.setItem("valueSound", valueSound.toString());
    }, [valueMic, valueSound]);
    
    return (
        <div style={{ flex: 1 }}>
            <div className={styles.sliderWrapper}>
                <Slider min={0} max={100} value={valueMic} onChange={e => setValueMic(Number(e.target.value))} />
                <span>Микрофон {valueMic}</span>
            </div>
            <div className={styles.sliderWrapper}>
                <Slider min={0} max={100} value={valueSound} onChange={e => setValueSound(Number(e.target.value))} />
                <span>Звук {valueSound}</span>
            </div>
        </div>
    )
}