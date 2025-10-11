import React, { useEffect, useRef, useState } from "react";
import { FiArrowRight } from "react-icons/fi";
import styles from "./FindInputText.module.css";

interface FindInputTextProps {
    onClick: () => void;
    onChange?: (value: string) => void;
}

const FindInputText: React.FC<FindInputTextProps> = ({ onClick, onChange }) => {
    const hiddenRef = useRef<HTMLInputElement>(null);
    const [targetContent, setTargetContent] = useState("");
    const [displayContent, setDisplayContent] = useState<{ char: string; anim: "top" | "bottom" }[]>([]);

    const refresh = (value: string) => {
        const truncated = value.slice(0, 30);
        setDisplayContent(
            truncated.split("").map((c, i) => ({ char: c, anim: i % 2 === 0 ? "top" : "bottom" }))
        );
        setTargetContent(truncated);
        onChange?.(truncated);
    };

    useEffect(() => {
        hiddenRef.current?.focus();
    }, []);

    return (
        <div className={styles.wrapper} onClick={() => hiddenRef.current?.focus()}>
            <div className={styles.input}>
                {displayContent.map((item, i) => (
                    <span
                        key={i}
                        className={item.anim === "top" ? styles.letterAnimTop : styles.letterAnimBottom}
                    >
                        {item.char}
                    </span>
                ))}
                <span className={styles.blink}>|</span>
            </div>
            <input
                ref={hiddenRef}
                className={styles.hiddenInput}
                type="text"
                maxLength={30}
                value={targetContent}
                onChange={(e) => refresh(e.target.value)}
            />
            <button className={styles.button} onClick={onClick}>
                <FiArrowRight />
            </button>
        </div>
    );
};

export default FindInputText;