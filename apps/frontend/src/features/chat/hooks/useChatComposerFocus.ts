import { useLayoutEffect, type RefObject } from "react"
import type { DisplayMessage } from "../types"

export function useChatComposerFocus(
    inputRef: RefObject<HTMLTextAreaElement | null>,
    name: string,
    id: number,
    is_room: boolean,
    replyTo: DisplayMessage | null
) {
    useLayoutEffect(() => {
        inputRef.current?.focus()
    }, [name, id, is_room, replyTo, inputRef])
}
