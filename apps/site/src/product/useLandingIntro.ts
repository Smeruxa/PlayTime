import { useRef, type RefObject } from "react"
import { gsap, useGSAP } from "../animations/gsapSetup"

export function useLandingIntro(root: RefObject<HTMLDivElement | null>) {
    const played = useRef(false)
    useGSAP(
        () => {
            const media = gsap.matchMedia()
            media.add(
                {
                    reduce: "(prefers-reduced-motion: reduce)",
                    desktop: "(min-width: 851px)",
                    compact: "(max-width: 850px)",
                },
                (context) => {
                    const node = root.current
                    if (!node) return
                    const connections = node.querySelector<HTMLElement>(".draft-connections")!
                    const svg = node.querySelector<SVGSVGElement>(".draft-connection-lines")!
                    const chips = [...node.querySelectorAll<HTMLElement>(".draft-signal-chip")]
                    const paths = [...node.querySelectorAll<SVGPathElement>("[data-signal-wire]")]
                    const copy = node.querySelectorAll("[data-enter]")
                    const demo = node.querySelector("[data-demo-enter]")
                    const orbits = node.querySelector(".draft-connection-orbits")
                    const compact = !!context.conditions?.compact
                    const layoutWires = () => {
                        const bounds = connections.getBoundingClientRect()
                        if (compact) {
                            const note = node
                                .querySelector(".draft-platform-note")!
                                .getBoundingClientRect()
                            connections.style.setProperty(
                                "--signal-row-y",
                                `${note.bottom - bounds.top + 18}px`
                            )
                        }
                        const centers = chips.map((chip) => {
                            return {
                                x: chip.offsetLeft + chip.offsetWidth / 2,
                                y: chip.offsetTop + chip.offsetHeight / 2,
                            }
                        })
                        svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`)
                        centers.forEach(({ x, y }, index) => {
                            const turnY = compact ? y + 75 : y + 160
                            const d =
                                compact && index === 1
                                    ? `M ${x} ${bounds.height + 40} V ${y}`
                                    : index === 0
                                      ? `M -40 ${turnY} H ${x - 30} Q ${x} ${turnY} ${x} ${turnY - 30} V ${y}`
                                      : `M ${bounds.width + 40} ${turnY} H ${x + 30} Q ${x} ${turnY} ${x} ${turnY - 30} V ${y}`
                            paths[index].setAttribute("d", d)
                        })
                        svg.querySelectorAll("ellipse").forEach((ellipse, index) => {
                            ellipse.setAttribute("cx", String(bounds.width / 2))
                            ellipse.setAttribute("rx", String(bounds.width * (index ? 0.64 : 0.52)))
                        })
                    }
                    layoutWires()
                    const observer = new ResizeObserver(layoutWires)
                    observer.observe(connections)
                    if (!context.conditions?.reduce && !played.current) {
                        const timeline = gsap.timeline({
                            defaults: { ease: "power3.out" },
                            onComplete: () => {
                                played.current = true
                            },
                        })
                        timeline.from(
                            copy,
                            {
                                y: 18,
                                autoAlpha: 0,
                                duration: 0.65,
                                stagger: 0.08,
                                clearProps: "transform,opacity,visibility",
                            },
                            0
                        )
                        timeline.fromTo(
                            orbits!.querySelectorAll("ellipse"),
                            {
                                attr: {
                                    "stroke-dasharray": "1000 1000",
                                    "stroke-dashoffset": 1000,
                                },
                            },
                            {
                                attr: { "stroke-dashoffset": 0 },
                                duration: 2.2,
                                ease: "power2.inOut",
                                stagger: 0.15,
                            },
                            0.3
                        )
                        paths.forEach((path, index) => {
                            timeline.fromTo(
                                path,
                                {
                                    attr: {
                                        "stroke-dasharray": "1000 1000",
                                        "stroke-dashoffset": 1000,
                                    },
                                },
                                {
                                    attr: { "stroke-dashoffset": 0 },
                                    duration: 1.6,
                                    ease: "power2.inOut",
                                },
                                0.18 + index * 0.16
                            )
                            timeline.from(
                                chips[index],
                                {
                                    autoAlpha: 0,
                                    scale: 0.65,
                                    y: 12,
                                    duration: 0.62,
                                    ease: "back.out(1.35)",
                                    clearProps: "transform,opacity,visibility",
                                },
                                1.78 + index * 0.16
                            )
                        })
                        timeline.from(
                            demo,
                            {
                                autoAlpha: 0,
                                y: 56,
                                scale: 0.985,
                                duration: 1.05,
                                clearProps: "transform,opacity,visibility",
                            },
                            2.65
                        )
                    } else {
                        gsap.set([...paths, ...orbits!.querySelectorAll("ellipse")], {
                            attr: { "stroke-dasharray": "1000 1000", "stroke-dashoffset": 0 },
                        })
                    }
                    return () => observer.disconnect()
                },
                root
            )
            return () => media.revert()
        },
        { scope: root }
    )
}
