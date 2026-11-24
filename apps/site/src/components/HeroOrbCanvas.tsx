import { useEffect, useRef } from "react"

type Props = {
    reduced: boolean
}

const ACCENT = "61, 255, 157"
const ACCENT2 = "110, 123, 255"
const MUTED = "244, 240, 232"

export function HeroOrbCanvas({ reduced }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const parallaxRef = useRef({ x: 0, y: 0 })
    const frameRef = useRef(0)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const parent = canvas.parentElement
        if (!parent) return

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const rings = [
            { r: 0.2, n: 10, w: 0.42 },
            { r: 0.36, n: 18, w: -0.32 },
            { r: 0.5, n: 26, w: 0.24 },
        ]

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2)
            const rect = parent.getBoundingClientRect()
            const w = rect.width
            const h = rect.height
            canvas.width = Math.max(1, w * dpr)
            canvas.height = Math.max(1, h * dpr)
            canvas.style.width = `${w}px`
            canvas.style.height = `${h}px`
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        }

        const ro = new ResizeObserver(resize)
        ro.observe(parent)
        resize()

        const drawFrame = (t: number) => {
            const w = parent.clientWidth
            const h = parent.clientHeight
            if (w < 2 || h < 2) return

            const cx = w / 2 + parallaxRef.current.x * 22
            const cy = h / 2 + parallaxRef.current.y * 16
            const time = reduced ? 0 : t * 0.0009

            ctx.fillStyle = "#09090b"
            ctx.fillRect(0, 0, w, h)

            const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.48)
            glow.addColorStop(0, `rgba(${ACCENT2}, 0.18)`)
            glow.addColorStop(0.35, `rgba(${ACCENT}, 0.07)`)
            glow.addColorStop(0.65, "rgba(255,61,110,0.05)")
            glow.addColorStop(1, "rgba(0,0,0,0)")
            ctx.fillStyle = glow
            ctx.fillRect(0, 0, w, h)

            ctx.save()
            ctx.translate(cx, cy)
            ctx.rotate(time * 0.55)
            const R = Math.min(w, h)
            for (let k = 0; k < 5; k++) {
                ctx.rotate(0.55)
                ctx.beginPath()
                ctx.arc(0, 0, R * (0.12 + k * 0.055), 0, Math.PI * 0.42)
                ctx.strokeStyle = `rgba(${ACCENT2}, ${0.06 + k * 0.02})`
                ctx.lineWidth = 1.5
                ctx.stroke()
            }
            ctx.restore()

            const pts: { x: number; y: number }[] = []
            rings.forEach((ring, ri) => {
                const rad = Math.min(w, h) * ring.r
                const rot = time * ring.w * 10 + ri * 0.7
                for (let i = 0; i < ring.n; i++) {
                    const a = (i / ring.n) * Math.PI * 2 + rot
                    pts.push({
                        x: cx + Math.cos(a) * rad * 0.94,
                        y: cy + Math.sin(a) * rad,
                    })
                }
            })

            const maxD = Math.min(w, h) * 0.13
            for (let i = 0; i < pts.length; i++) {
                for (let j = i + 1; j < pts.length; j++) {
                    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
                    if (d < maxD) {
                        const alpha = (1 - d / maxD) * 0.32
                        ctx.strokeStyle = `rgba(${MUTED}, ${alpha})`
                        ctx.lineWidth = 0.75
                        ctx.beginPath()
                        ctx.moveTo(pts[i].x, pts[i].y)
                        ctx.lineTo(pts[j].x, pts[j].y)
                        ctx.stroke()
                    }
                }
            }

            pts.forEach((p, i) => {
                const pulse = reduced ? 1 : 0.55 + 0.45 * Math.sin(time * 4 + i * 0.15)
                ctx.fillStyle = `rgba(${ACCENT}, ${0.28 * pulse})`
                ctx.beginPath()
                ctx.arc(p.x, p.y, 2, 0, Math.PI * 2)
                ctx.fill()
            })
        }

        if (reduced) {
            drawFrame(0)
            return () => ro.disconnect()
        }

        let raf = 0
        let cancelled = false
        const loop = (now: number) => {
            if (cancelled) return
            frameRef.current = now
            drawFrame(now)
            raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        return () => {
            cancelled = true
            cancelAnimationFrame(raf)
            ro.disconnect()
        }
    }, [reduced])

    return (
        <canvas
            ref={canvasRef}
            className="hero__orb-canvas"
            aria-hidden
            onPointerMove={(e) => {
                if (reduced) return
                const r = e.currentTarget.getBoundingClientRect()
                parallaxRef.current = {
                    x: (e.clientX - r.left) / r.width - 0.5,
                    y: (e.clientY - r.top) / r.height - 0.5,
                }
            }}
            onPointerLeave={() => {
                parallaxRef.current = { x: 0, y: 0 }
            }}
        />
    )
}
