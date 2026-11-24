type ChatEmojiImgProps = {
    emoji: string
    className?: string
    title?: string
}

export function ChatEmojiImg({ emoji, className, title }: ChatEmojiImgProps) {
    return <span className={className} title={title} role="img" aria-label={title ?? emoji}>{emoji}</span>
}
