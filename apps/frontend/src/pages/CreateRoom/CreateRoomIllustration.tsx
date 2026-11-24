import type { ImgHTMLAttributes } from "react"
import roomIllustration from "./create-room-lounge-v1.webp"

export function CreateRoomIllustration(props: ImgHTMLAttributes<HTMLImageElement>) {
    return (
        <img
            {...props}
            src={roomIllustration}
            width={1280}
            height={659}
            alt=""
            aria-hidden="true"
            draggable={false}
            decoding="async"
        />
    )
}
