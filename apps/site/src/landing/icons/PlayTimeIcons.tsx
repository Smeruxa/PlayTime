import type { ReactNode } from "react"

type IconProps = {
    className?: string
    size?: number
}

function Svg({ className, size = 20, children }: IconProps & { children: ReactNode }) {
    return (
        <svg
            className={className}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
        >
            {children}
        </svg>
    )
}

export function IconEnvelope(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5L4 8V6l8 5 8-5v2z" />
        </Svg>
    )
}

export function IconUsers(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
        </Svg>
    )
}

export function IconPlusSquare(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-2v-4H8v-2h4V8h2v4h4v2z" />
        </Svg>
    )
}

export function IconPhone(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.57c-2.83-1.44-5.15-3.75-6.59-6.59l1.57-1.57c.27-.27.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.55-.45-1-1-1H4.5C3.67 3 3 3.67 3 4.5 3 13.39 10.61 21 19.5 21c.83 0 1.5-.67 1.5-1.5v-3.49c0-.55-.45-1-1-1z" />
        </Svg>
    )
}

export function IconSearch(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </Svg>
    )
}

export function IconShield(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
        </Svg>
    )
}

export function IconScreen(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z" />
        </Svg>
    )
}

export function IconMic(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.48 14.48 16.5 12 16.5s-4.52-2.02-4.93-4.65c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
        </Svg>
    )
}

export function IconSend(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
        </Svg>
    )
}

export function IconBell(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6V9c0-3.07-1.63-5.64-4.5-6.32V2c0-.83-.67-1.5-1.5-1.5S10.5 1.17 10.5 2v.68C7.64 3.36 6 5.92 6 9v7l-2 2v1h16v-1l-2-2zm-2 1H8V9c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v8z" />
        </Svg>
    )
}

export function IconHash(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M9.5 3h-2L6.5 9H4v2h2.5L5 17H3v2h2.5L4.5 21h2l1-6h3l-1 6h2l1-6H17v-2h-2.5l1-6H18V9h-2.5l.5-3h-2l-.5 3h-3l.5-3h-2l-.5 3H9.5l.5-3zm-.5 8h3l-1 6h-3l1-6z" />
        </Svg>
    )
}

export function IconMicOff(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3 3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.48 0-4.52-2.02-4.93-4.65h-1.7c.62 3.01 3.1 5.25 6.1 5.68V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c.96-.13 1.85-.45 2.67-.9l4.23 4.23 1.27-1.27L4.27 3z" />
        </Svg>
    )
}

export function IconPhoneHangup(props: IconProps) {
    const size = props.size ?? 20
    return (
        <svg
            className={props.className}
            width={size}
            height={size}
            viewBox="0 0 640 512"
            fill="currentColor"
            aria-hidden
        >
            <path d="M268.2 381.4l-49.6-60.6c-6.8-8.3-18.2-11.1-28-6.9l-112 48c-10.7 4.6-16.5 16.1-13.9 27.5l24 104c2.5 10.8 12.1 18.6 23.4 18.6 100.7 0 193.7-32.4 269.7-86.9l-80-61.8c-10.9 6.5-22.1 12.7-33.6 18.1zm365.6 76.7L475.1 335.5C537.9 256.4 576 156.9 576 48c0-11.2-7.7-20.9-18.6-23.4l-104-24c-11.3-2.6-22.9 3.3-27.5 13.9l-48 112c-4.2 9.8-1.4 21.3 6.9 28l60.6 49.6c-12.2 26.1-27.9 50.3-46 72.8L45.5 3.4C38.5-2 28.5-.8 23 6.2L3.4 31.4c-5.4 7-4.2 17 2.8 22.4l588.4 454.7c7 5.4 17 4.2 22.5-2.8l19.6-25.3c5.4-6.8 4.1-16.9-2.9-22.3z" />
        </svg>
    )
}

export function IconCheck(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </Svg>
    )
}
