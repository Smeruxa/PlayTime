import { useId } from "react"
import type { AvatarEffectId } from "../../../profile/avatarEffects"
import styles from "./AvatarEffectOverlay.module.css"

type Props = {
    effectId: AvatarEffectId
    compact?: boolean
}

export function AvatarEffectOverlay({ effectId, compact }: Props) {
    const uid = useId().replace(/:/g, "")
    const grad = `avatar-grad-${uid}`
    const frostGrad = `avatar-frost-${uid}`
    const flareGrad = `avatar-flare-${uid}`
    const prismGrad = `avatar-prism-${uid}`
    const petal = `avatar-petal-${uid}`

    return (
        <svg
            className={[styles.svg, compact ? styles.svgCompact : ""].filter(Boolean).join(" ")}
            viewBox="0 0 100 100"
            aria-hidden
        >
            <defs>
                <linearGradient id={grad} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2ee7ff" />
                    <stop offset="45%" stopColor="#3aa8ff" />
                    <stop offset="100%" stopColor="#6e7bff" />
                </linearGradient>
                <linearGradient id={frostGrad} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#e8f4ff" />
                    <stop offset="50%" stopColor="#9fd4ff" />
                    <stop offset="100%" stopColor="#6eb8ff" />
                </linearGradient>
                <linearGradient id={flareGrad} x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#ff6a2e" />
                    <stop offset="50%" stopColor="#ffb347" />
                    <stop offset="100%" stopColor="#ffe08a" />
                </linearGradient>
                <linearGradient id={prismGrad} x1="0%" y1="50%" x2="100%" y2="50%">
                    <stop offset="0%" stopColor="#ff6eb4" />
                    <stop offset="33%" stopColor="#b388ff" />
                    <stop offset="66%" stopColor="#5ecbff" />
                    <stop offset="100%" stopColor="#7dffb3" />
                </linearGradient>
                <path id={petal} d="M0,-4.5 C1.8,-1.6 2.4,2.2 0,5.5 C-2.4,2.2 -1.8,-1.6 0,-4.5 Z" />
            </defs>

            {effectId === "halo" ? (
                <circle
                    className={styles.haloStroke}
                    cx="50"
                    cy="50"
                    r="46"
                    fill="none"
                    stroke={`url(#${grad})`}
                    strokeWidth="3"
                    strokeLinecap="round"
                />
            ) : null}

            {effectId === "orbit" ? (
                <circle
                    className={styles.orbitStroke}
                    cx="50"
                    cy="50"
                    r="46"
                    fill="none"
                    stroke={`url(#${grad})`}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray="72 220"
                />
            ) : null}

            {effectId === "neon" ? (
                <>
                    <circle
                        className={styles.neonOuter}
                        cx="50"
                        cy="50"
                        r="47"
                        fill="none"
                        stroke={`url(#${grad})`}
                        strokeWidth="2"
                        opacity="0.55"
                    />
                    <circle
                        className={styles.neonInner}
                        cx="50"
                        cy="50"
                        r="46"
                        fill="none"
                        stroke="#2ee7ff"
                        strokeWidth="1"
                        opacity="0.35"
                    />
                </>
            ) : null}

            {effectId === "stars" ? (
                <g className={styles.glints}>
                    <circle className={styles.glint} cx="28" cy="30" r="2.2" fill="#fff" />
                    <circle
                        className={styles.glint}
                        cx="72"
                        cy="38"
                        r="1.6"
                        fill="#2ee7ff"
                        style={{ animationDelay: "0.6s" }}
                    />
                    <circle
                        className={styles.glint}
                        cx="62"
                        cy="72"
                        r="1.8"
                        fill="#fff"
                        style={{ animationDelay: "1.2s" }}
                    />
                </g>
            ) : null}

            {effectId === "frost" ? (
                <>
                    <circle
                        className={styles.frostRing}
                        cx="50"
                        cy="50"
                        r="46"
                        fill="none"
                        stroke={`url(#${frostGrad})`}
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeDasharray="8 10"
                    />
                    <g className={styles.frostFlakes}>
                        <circle cx="24" cy="42" r="1.2" fill="#fff" opacity="0.9" />
                        <circle
                            cx="76"
                            cy="36"
                            r="1"
                            fill="#d8ecff"
                            opacity="0.85"
                            style={{ animationDelay: "0.5s" }}
                        />
                        <circle cx="68" cy="70" r="1.1" fill="#fff" opacity="0.8" style={{ animationDelay: "1s" }} />
                    </g>
                </>
            ) : null}

            {effectId === "flare" ? (
                <>
                    <circle
                        className={styles.flareRing}
                        cx="50"
                        cy="50"
                        r="46"
                        fill="none"
                        stroke={`url(#${flareGrad})`}
                        strokeWidth="2.8"
                        strokeLinecap="round"
                    />
                    <circle
                        className={styles.flareGlow}
                        cx="50"
                        cy="50"
                        r="44"
                        fill="none"
                        stroke="#ff9040"
                        strokeWidth="1"
                        opacity="0.35"
                    />
                </>
            ) : null}

            {effectId === "bloom" ? (
                <g className={styles.bloomGroup}>
                    {[0, 72, 144, 216, 288].map((deg) => (
                        <use
                            key={deg}
                            href={`#${petal}`}
                            fill="#ffb7d4"
                            opacity="0.92"
                            transform={`rotate(${deg} 50 50) translate(50 4)`}
                        />
                    ))}
                </g>
            ) : null}

            {effectId === "prism" ? (
                <circle
                    className={styles.prismArc}
                    cx="50"
                    cy="50"
                    r="46"
                    fill="none"
                    stroke={`url(#${prismGrad})`}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray="90 200"
                />
            ) : null}
        </svg>
    )
}
