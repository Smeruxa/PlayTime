import type { ReactNode } from "react"

export function splitChars(text: string, className?: string): ReactNode[] {
    return text.split("").map((char, i) => (
        <span
            key={`${char}-${i}`}
            data-split-char
            className={className}
            aria-hidden={char === " "}
        >
            {char === " " ? "\u00A0" : char}
        </span>
    ))
}

export function splitWords(text: string, className?: string): ReactNode[] {
    return text.split(/(\s+)/).map((part, i) =>
        part.trim() === "" ? (
            part
        ) : (
            <span key={`${part}-${i}`} data-split-word className={className}>
                {part}
            </span>
        )
    )
}
