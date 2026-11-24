import { useId, useRef, useState } from "react"
import { ensureGsapPlugins, gsap, useGSAP } from "../animations/gsapSetup"
import "./appearance-showcase.css"

ensureGsapPlugins()

export function AppearanceShowcase() {
    const root = useRef<HTMLElement>(null)
    const playback = useRef<(() => void) | null>(null)
    const userPaused = useRef(false)
    const [paused, setPaused] = useState(false)
    const id = `appearance-${useId().replace(/:/g, "")}`
    useGSAP(
        () => {
            const media = gsap.matchMedia()
            media.add(
                "(prefers-reduced-motion: no-preference)",
                () => {
                    const node = root.current
                    if (!node) return
                    const layers = [...node.querySelectorAll<SVGGElement>("[data-wave-layer]")]
                    const motion = layers.map((layer, index) =>
                        gsap.fromTo(
                            layer,
                            { x: -3 + index * 2, y: index * 2, rotation: -0.7 },
                            {
                                x: 4 - index,
                                y: -6 - index * 2,
                                rotation: 0.8,
                                svgOrigin: "360 155",
                                duration: 5.4 + index * 1.7,
                                repeat: -1,
                                yoyo: true,
                                ease: "sine.inOut",
                                paused: true,
                            }
                        )
                    )
                    motion.push(
                        gsap.to(node.querySelectorAll("[data-wave-spark]"), {
                            y: -6,
                            opacity: 0.35,
                            stagger: { each: 0.3, from: "start" },
                            duration: 2.6,
                            repeat: -1,
                            yoyo: true,
                            ease: "sine.inOut",
                            paused: true,
                        })
                    )
                    let inView = false
                    const updatePlayback = () => {
                        const play = inView && !document.hidden && !userPaused.current
                        for (const tween of motion) tween.paused(!play)
                    }
                    playback.current = updatePlayback
                    const observer = new IntersectionObserver(
                        ([entry]) => {
                            inView = entry.isIntersecting
                            updatePlayback()
                        },
                        { rootMargin: "40px" }
                    )
                    observer.observe(node)
                    document.addEventListener("visibilitychange", updatePlayback)
                    return () => {
                        observer.disconnect()
                        document.removeEventListener("visibilitychange", updatePlayback)
                        playback.current = null
                    }
                },
                root
            )
            return () => media.revert()
        },
        { scope: root }
    )
    const toggleMotion = () => {
        userPaused.current = !userPaused.current
        setPaused(userPaused.current)
        playback.current?.()
    }
    return (
        <figure
            ref={root}
            className="draft-appearance-showcase"
            aria-label="Пример оформления профиля"
        >
            <div className="draft-appearance-composition">
                <div className="draft-appearance-profile">
                    <div className="draft-appearance-banner">
                        <div className="draft-appearance-banner-orbit" />
                        <span className="draft-appearance-banner-type" aria-hidden="true">
                            blue
                            <br />
                            hour.
                        </span>
                        <span className="draft-appearance-banner-index" aria-hidden="true">
                            PLAYTIME / 01
                        </span>
                    </div>
                    <div className="draft-appearance-identity">
                        <div className="draft-appearance-portrait">
                            <img
                                data-appearance-art
                                src={`${import.meta.env.BASE_URL}assets/appearance/playtime-mika-v1.jpg`}
                                width={640}
                                height={640}
                                alt="Аниме-аватар Мики в синих наушниках"
                                loading="lazy"
                                decoding="async"
                            />
                            <span className="draft-appearance-online" aria-label="В сети" />
                        </div>
                        <div className="draft-appearance-person">
                            <strong>
                                mika<span>✧</span>
                            </strong>
                            <span>@mika</span>
                        </div>
                        <svg
                            className="draft-appearance-profile-star"
                            width="23"
                            height="23"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                        >
                            <path
                                d="m12 1 2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6L12 1Z"
                                stroke="currentColor"
                            />
                        </svg>
                    </div>
                    <p className="draft-appearance-profile-bio">Немного музыки. Немного магии.</p>
                    <div className="draft-appearance-profile-foot" aria-hidden="true">
                        <span>
                            <i />
                            <i />
                            <i />
                            <i />
                            На своей волне
                        </span>
                        <span>✦</span>
                    </div>
                </div>
                <svg
                    className="draft-appearance-wave"
                    viewBox="0 0 600 320"
                    fill="none"
                    aria-hidden="true"
                >
                    <defs>
                        <linearGradient
                            id={`${id}-body`}
                            x1="95"
                            y1="235"
                            x2="505"
                            y2="45"
                            gradientUnits="userSpaceOnUse"
                        >
                            <stop stopColor="#14417b" />
                            <stop offset=".35" stopColor="#2876c5" />
                            <stop offset=".63" stopColor="#36c3f4" />
                            <stop offset=".8" stopColor="#99f4ff" />
                            <stop offset="1" stopColor="#37a9dd" />
                        </linearGradient>
                        <linearGradient
                            id={`${id}-fold`}
                            x1="290"
                            y1="226"
                            x2="460"
                            y2="80"
                            gradientUnits="userSpaceOnUse"
                        >
                            <stop stopColor="#15396a" />
                            <stop offset=".52" stopColor="#237fb1" />
                            <stop offset="1" stopColor="#163a64" />
                        </linearGradient>
                        <linearGradient
                            id={`${id}-rim`}
                            x1="82"
                            y1="200"
                            x2="493"
                            y2="60"
                            gradientUnits="userSpaceOnUse"
                        >
                            <stop stopColor="#4889c9" stopOpacity="0" />
                            <stop offset=".45" stopColor="#62d6ff" />
                            <stop offset=".8" stopColor="#d4fdff" />
                            <stop offset="1" stopColor="#76e0f4" />
                        </linearGradient>
                        <linearGradient
                            id={`${id}-ribbon`}
                            x1="76"
                            y1="250"
                            x2="544"
                            y2="115"
                            gradientUnits="userSpaceOnUse"
                        >
                            <stop stopColor="#13519a" stopOpacity="0" />
                            <stop offset=".4" stopColor="#449cdf" />
                            <stop offset=".74" stopColor="#63e8f4" />
                            <stop offset="1" stopColor="#b8faff" stopOpacity=".55" />
                        </linearGradient>
                        <linearGradient
                            id={`${id}-warm`}
                            x1="412"
                            y1="56"
                            x2="549"
                            y2="126"
                            gradientUnits="userSpaceOnUse"
                        >
                            <stop stopColor="#f2b097" />
                            <stop offset="1" stopColor="#f5c2b7" stopOpacity="0" />
                        </linearGradient>
                        <linearGradient
                            id={`${id}-tail`}
                            x1="65"
                            y1="0"
                            x2="190"
                            y2="0"
                            gradientUnits="userSpaceOnUse"
                        >
                            <stop stopColor="white" stopOpacity="0" />
                            <stop offset=".5" stopColor="white" stopOpacity=".35" />
                            <stop offset="1" stopColor="white" />
                        </linearGradient>
                        <mask
                            id={`${id}-fade`}
                            maskUnits="userSpaceOnUse"
                            x="-30"
                            y="-30"
                            width="680"
                            height="390"
                        >
                            <rect
                                x="-30"
                                y="-30"
                                width="680"
                                height="390"
                                fill={`url(#${id}-tail)`}
                            />
                        </mask>
                    </defs>
                    <g mask={`url(#${id}-fade)`}>
                        <g data-wave-layer>
                            <path
                                d="M65 235C170 251 259 216 313 150C344 111 348 61 396 39C446 16 512 36 537 83C511 59 481 65 470 88C452 125 482 162 524 157C551 154 567 138 575 127C566 172 528 199 489 192C446 185 426 154 432 121C416 145 402 184 363 211C291 263 172 285 65 259Z"
                                fill={`url(#${id}-body)`}
                            />
                            <path
                                d="M65 259C178 279 292 263 363 211C402 184 416 145 432 121C426 154 446 185 489 192C465 198 445 191 428 177C407 223 360 252 305 268C229 288 144 280 65 259Z"
                                fill={`url(#${id}-fold)`}
                            />
                            <path
                                d="M69 234C177 250 258 216 313 150C346 110 348 61 396 39C446 16 512 36 537 83"
                                stroke={`url(#${id}-rim)`}
                                strokeWidth="2.5"
                                strokeLinecap="round"
                            />
                            <path
                                d="M406 40C458 23 511 44 532 78C506 58 479 67 470 88C452 125 482 162 524 157"
                                stroke={`url(#${id}-rim)`}
                                strokeWidth="1.2"
                                strokeLinecap="round"
                            />
                            {Array.from({ length: 8 }, (_, i) => (
                                <path
                                    key={i}
                                    d={`M${92 + i * 9} ${244 + i * 1.2}C${207 + i * 5} ${255 + i * 1.5} ${281 + i * 4} ${210 + i * 2} ${328 + i * 3} ${142 + i * 2}C${355 + i * 2} ${101 + i} ${365 + i * 2} ${62 + i} ${405 + i * 3} ${48 + i * 1.7}`}
                                    stroke="#b7f6ff"
                                    strokeWidth=".65"
                                    opacity={0.1 + i * 0.018}
                                />
                            ))}
                        </g>
                        <g data-wave-layer>
                            <path
                                d="M82 264C196 276 319 251 390 187C432 150 447 113 478 108C503 104 535 117 554 135C534 125 511 123 495 130C467 143 463 180 421 214C344 277 197 296 82 264Z"
                                fill={`url(#${id}-ribbon)`}
                                opacity=".76"
                            />
                            <path
                                d="M90 264C204 277 324 251 393 187C435 149 450 113 478 108C503 104 535 117 554 135"
                                stroke={`url(#${id}-rim)`}
                                strokeWidth="1.1"
                            />
                            <path
                                d="M417 32C459 20 499 43 521 66"
                                stroke={`url(#${id}-warm)`}
                                strokeWidth="1.8"
                                strokeLinecap="round"
                            />
                        </g>
                        <g data-wave-layer stroke="#95dce9" strokeLinecap="round">
                            <path d="M146 244C233 264 308 244 358 221" opacity=".28" />
                            <path d="M400 15C425 7 451 9 471 17" opacity=".5" />
                            <path d="M544 91C555 98 562 109 565 119" opacity=".4" />
                            <path d="M498 213C530 209 553 195 569 176" opacity=".25" />
                        </g>
                        <g fill="#9ce8f7">
                            <ellipse
                                data-wave-spark
                                cx="379"
                                cy="24"
                                rx="3"
                                ry="6"
                                transform="rotate(30 379 24)"
                            />
                            <ellipse
                                data-wave-spark
                                cx="490"
                                cy="23"
                                rx="2"
                                ry="4"
                                transform="rotate(-35 490 23)"
                            />
                            <circle data-wave-spark cx="558" cy="77" r="2.4" />
                            <circle data-wave-spark cx="584" cy="135" r="1.6" />
                            <path
                                data-wave-spark
                                d="m348 62 1.7 5.3L355 69l-5.3 1.7L348 76l-1.7-5.3L341 69l5.3-1.7L348 62Z"
                                opacity=".8"
                            />
                            <path
                                data-wave-spark
                                d="m548 196 1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5L548 196Z"
                                opacity=".6"
                            />
                        </g>
                    </g>
                </svg>
            </div>
            <figcaption className="draft-appearance-showcase-caption">
                <span>Цвет. Характер. Твоя атмосфера.</span>
                <button
                    className="draft-appearance-motion-button"
                    type="button"
                    onClick={toggleMotion}
                    aria-pressed={paused}
                    aria-label={paused ? "Включить анимацию" : "Приостановить анимацию"}
                    title={paused ? "Включить анимацию" : "Приостановить анимацию"}
                >
                    <svg
                        width="13"
                        height="13"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        {paused ? (
                            <path d="m5 3 7 5-7 5V3Z" />
                        ) : (
                            <>
                                <rect x="4" y="3" width="2.5" height="10" rx="1" />
                                <rect x="9.5" y="3" width="2.5" height="10" rx="1" />
                            </>
                        )}
                    </svg>
                </button>
            </figcaption>
        </figure>
    )
}
