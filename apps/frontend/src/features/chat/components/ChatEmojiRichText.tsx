import { Fragment, useMemo, type ReactNode } from "react"
import emojiRegex from "emoji-regex"
import { ChatEmojiImg } from "./ChatEmojiImg"

type ChatEmojiRichTextProps = {
    text: string
    imgClassName: string
    linkClassName?: string
}

const URL_RE = /((?:https?:\/\/|www\.)[^\s<>,[\]()]+[^\s<>,[\].!?;:])/gi

function linkifyPlain(text: string, keyBase: number, linkClassName?: string): ReactNode[] {
    const nodes: ReactNode[] = []
    let last = 0
    let k = keyBase
    URL_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = URL_RE.exec(text)) !== null) {
        const m = match[0]
        const idx = match.index
        if (idx > last) nodes.push(<Fragment key={`t${k++}`}>{text.slice(last, idx)}</Fragment>)
        const href = m.startsWith("www.") ? `https://${m}` : m
        nodes.push(
            <a
                key={`u${k++}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClassName}
                onClick={(e) => e.stopPropagation()}
            >
                {m}
            </a>
        )
        last = idx + m.length
        if (m.length === 0) URL_RE.lastIndex += 1
    }
    if (last < text.length) nodes.push(<Fragment key={`t${k++}`}>{text.slice(last)}</Fragment>)
    return nodes.length ? nodes : [text]
}

export function ChatEmojiRichText({ text, imgClassName, linkClassName }: ChatEmojiRichTextProps) {
    const re = useMemo(() => emojiRegex(), [])
    const nodes: ReactNode[] = []
    let last = 0
    let k = 0
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
        const m = match[0]
        const idx = match.index
        if (idx > last) {
            nodes.push(...linkifyPlain(text.slice(last, idx), k, linkClassName))
            k += 1000
        }
        nodes.push(<ChatEmojiImg key={`e${k++}`} emoji={m} className={imgClassName} title={m} />)
        last = idx + m.length
        if (m.length === 0) re.lastIndex += 1
    }
    if (last < text.length) {
        nodes.push(...linkifyPlain(text.slice(last), k, linkClassName))
    }
    if (nodes.length === 0) return text
    return <>{nodes}</>
}
