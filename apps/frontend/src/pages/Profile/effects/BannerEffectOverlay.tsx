import { useId, type CSSProperties } from "react"
import type { BannerEffectId } from "../../../profile/bannerEffects"
import styles from "./BannerEffectOverlay.module.css"

const VB_W = 600
const VB_H = 200

type Props = {
    effectId: BannerEffectId
}

type ParticleStyle = CSSProperties & {
    "--sx"?: string
    "--drift"?: string
    "--rot"?: string
    "--scale"?: string
    "--delay"?: string
    "--dur"?: string
}

function particleStyle(vars: Record<string, string | number>): ParticleStyle {
    const duration = Number.parseFloat(String(vars["--dur"]))
    const delay = Number.parseFloat(String(vars["--delay"]))
    return { ...vars, "--delay": `${-(duration * 0.25 + delay)}s` } as ParticleStyle
}

export function BannerEffectOverlay({ effectId }: Props) {
    const uid = useId().replace(/:/g, "")
    if (effectId === "glow") return <div className={styles.softGlow} aria-hidden />
    const petal = `petal-${uid}`
    const snowflake = `snowflake-${uid}`
    const emberGlow = `ember-glow-${uid}`
    const sakuraAmbient = `sakura-ambient-${uid}`
    const emberAmbient = `ember-ambient-${uid}`

    return (
        <svg className={styles.svg} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
            <defs>
                <linearGradient id={sakuraAmbient} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(255,180,210,0.12)" />
                    <stop offset="55%" stopColor="rgba(255,120,170,0.06)" />
                    <stop offset="100%" stopColor="rgba(80,20,50,0.2)" />
                </linearGradient>
                <linearGradient id={emberAmbient} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="rgba(255,90,30,0.35)" />
                    <stop offset="45%" stopColor="rgba(180,40,10,0.12)" />
                    <stop offset="100%" stopColor="rgba(20,8,4,0)" />
                </linearGradient>
                <path id={petal} d="M0,-9 C4.2,-3.2 5.5,4.5 0,11 C-5.5,4.5 -4.2,-3.2 0,-9 Z" />
                <g id={snowflake} stroke="rgba(255,255,255,0.9)" strokeWidth="0.9" strokeLinecap="round">
                    <line x1="0" y1="-5" x2="0" y2="5" />
                    <line x1="-4.3" y1="-2.5" x2="4.3" y2="2.5" />
                    <line x1="-4.3" y1="2.5" x2="4.3" y2="-2.5" />
                </g>
                <filter id={emberGlow} x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur stdDeviation="2.2" result="b" />
                    <feMerge>
                        <feMergeNode in="b" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            {effectId === "sakura" ? <SakuraScene petalId={petal} ambientId={sakuraAmbient} /> : null}
            {effectId === "snow" ? <SnowScene flakeId={snowflake} /> : null}
            {effectId === "stars" ? <FireflyScene /> : null}
            {effectId === "ember" ? <EmberScene glowId={emberGlow} ambientId={emberAmbient} /> : null}
        </svg>
    )
}

function SakuraScene({ petalId, ambientId }: { petalId: string; ambientId: string }) {
    return (
        <g className={styles.scene}>
            <rect fill={`url(#${ambientId})`} width={VB_W} height={VB_H} />
            {SAKURA_PETALS.map((p) => (
                <g
                    key={p.id}
                    className={styles.sakuraPetal}
                    style={particleStyle({
                        "--sx": `${p.x}px`,
                        "--drift": `${p.drift}px`,
                        "--rot": `${p.rot}deg`,
                        "--scale": p.scale,
                        "--delay": `${p.delay}s`,
                        "--dur": `${p.dur}s`
                    })}
                >
                    <use href={`#${petalId}`} fill={p.tone} opacity={p.alpha} />
                </g>
            ))}
        </g>
    )
}

const SAKURA_PETALS = [
    { id: 1, x: 40, drift: 36, rot: 12, scale: 1, delay: 0, dur: 11, tone: "#ffc0d8", alpha: 0.92 },
    { id: 2, x: 95, drift: -28, rot: 45, scale: 0.85, delay: 1.2, dur: 13, tone: "#ffb7d4", alpha: 0.88 },
    { id: 3, x: 160, drift: 42, rot: 80, scale: 1.05, delay: 0.4, dur: 10, tone: "#ffe0ec", alpha: 0.95 },
    { id: 4, x: 230, drift: -35, rot: 20, scale: 0.9, delay: 2.1, dur: 12, tone: "#ff9ec4", alpha: 0.85 },
    { id: 5, x: 300, drift: 30, rot: 130, scale: 1, delay: 0.8, dur: 14, tone: "#ffd0e5", alpha: 0.9 },
    { id: 6, x: 370, drift: -40, rot: 200, scale: 0.95, delay: 1.6, dur: 11.5, tone: "#ffb0cc", alpha: 0.88 },
    { id: 7, x: 440, drift: 38, rot: 260, scale: 0.8, delay: 2.8, dur: 13.5, tone: "#ffe8f2", alpha: 0.92 },
    { id: 8, x: 510, drift: -32, rot: 310, scale: 1.1, delay: 0.2, dur: 10.5, tone: "#ff8eb8", alpha: 0.86 },
    { id: 9, x: 75, drift: 25, rot: 160, scale: 0.75, delay: 3.2, dur: 15, tone: "#ffdce8", alpha: 0.8 },
    { id: 10, x: 265, drift: -22, rot: 95, scale: 0.88, delay: 1.9, dur: 12.5, tone: "#ffc8de", alpha: 0.9 },
    { id: 11, x: 400, drift: 45, rot: 40, scale: 0.7, delay: 3.6, dur: 14.5, tone: "#fff0f6", alpha: 0.85 },
    { id: 12, x: 550, drift: -38, rot: 175, scale: 0.92, delay: 2.4, dur: 11, tone: "#ffaac8", alpha: 0.88 }
]

function SnowScene({ flakeId }: { flakeId: string }) {
    return (
        <g className={styles.scene}>
            <rect className={styles.snowAmbient} width={VB_W} height={VB_H} />
            {SNOW_FLAKES.map((f) => (
                <g
                    key={f.id}
                    className={styles.snowFlake}
                    style={particleStyle({
                        "--sx": `${f.x}px`,
                        "--drift": `${f.drift}px`,
                        "--rot": `${f.rot}deg`,
                        "--scale": f.scale,
                        "--delay": `${f.delay}s`,
                        "--dur": `${f.dur}s`
                    })}
                >
                    <use href={`#${flakeId}`} opacity={f.alpha} />
                </g>
            ))}
        </g>
    )
}

const SNOW_FLAKES = [
    { id: 1, x: 30, drift: 18, rot: 0, scale: 0.9, delay: 0, dur: 9, alpha: 0.85 },
    { id: 2, x: 80, drift: -14, rot: 60, scale: 0.7, delay: 0.8, dur: 11, alpha: 0.75 },
    { id: 3, x: 130, drift: 22, rot: 120, scale: 1, delay: 1.5, dur: 10, alpha: 0.9 },
    { id: 4, x: 190, drift: -20, rot: 30, scale: 0.8, delay: 0.3, dur: 12, alpha: 0.8 },
    { id: 5, x: 250, drift: 16, rot: 200, scale: 0.95, delay: 2.1, dur: 9.5, alpha: 0.88 },
    { id: 6, x: 310, drift: -24, rot: 90, scale: 0.75, delay: 1.1, dur: 13, alpha: 0.72 },
    { id: 7, x: 360, drift: 20, rot: 150, scale: 1.05, delay: 2.6, dur: 10.5, alpha: 0.92 },
    { id: 8, x: 420, drift: -18, rot: 40, scale: 0.85, delay: 0.6, dur: 11.5, alpha: 0.78 },
    { id: 9, x: 470, drift: 26, rot: 260, scale: 0.65, delay: 3.2, dur: 14, alpha: 0.7 },
    { id: 10, x: 520, drift: -22, rot: 310, scale: 0.9, delay: 1.8, dur: 9, alpha: 0.86 },
    { id: 11, x: 560, drift: 12, rot: 180, scale: 0.55, delay: 2.9, dur: 12.5, alpha: 0.65 },
    { id: 12, x: 110, drift: -16, rot: 220, scale: 0.6, delay: 3.8, dur: 15, alpha: 0.68 },
    { id: 13, x: 340, drift: 14, rot: 70, scale: 0.72, delay: 4.1, dur: 13.5, alpha: 0.74 },
    { id: 14, x: 200, drift: -12, rot: 280, scale: 0.88, delay: 4.5, dur: 11, alpha: 0.82 }
]

function FireflyScene() {
    return (
        <g className={styles.scene}>
            <rect className={styles.fireflyAmbient} width={VB_W} height={VB_H} />
            {SHOOTING_STARS.map((s) => (
                <line
                    key={s.id}
                    className={styles.shootingStar}
                    x1={s.x1}
                    y1={s.y1}
                    x2={s.x2}
                    y2={s.y2}
                    style={particleStyle({
                        "--delay": `${s.delay}s`,
                        "--dur": `${s.dur}s`
                    })}
                />
            ))}
            {FIREFLIES.map((f) => (
                <circle
                    key={f.id}
                    className={styles.firefly}
                    r={f.r}
                    fill={f.color}
                    style={particleStyle({
                        "--sx": `${f.x}px`,
                        "--sy": `${f.y}px`,
                        "--drift": `${f.drift}px`,
                        "--rise": `${f.rise}px`,
                        "--delay": `${f.delay}s`,
                        "--dur": `${f.dur}s`
                    })}
                />
            ))}
        </g>
    )
}

const SHOOTING_STARS = [
    { id: "ss1", x1: 120, y1: 20, x2: 200, y2: 55, delay: 0, dur: 4.5 },
    { id: "ss2", x1: 380, y1: 8, x2: 470, y2: 48, delay: 2.8, dur: 5 },
    { id: "ss3", x1: 520, y1: 35, x2: 590, y2: 72, delay: 5.2, dur: 4.2 }
]

const FIREFLIES = [
    { id: 1, x: 55, y: 120, r: 2.2, drift: 28, rise: -35, delay: 0, dur: 7, color: "rgba(46,231,255,0.95)" },
    { id: 2, x: 140, y: 150, r: 1.6, drift: -22, rise: -28, delay: 1.1, dur: 8.5, color: "rgba(255,255,255,0.9)" },
    { id: 3, x: 220, y: 90, r: 2.5, drift: 32, rise: -42, delay: 0.4, dur: 6.5, color: "rgba(110,200,255,0.9)" },
    { id: 4, x: 310, y: 130, r: 1.8, drift: -30, rise: -38, delay: 2.2, dur: 9, color: "rgba(46,231,255,0.85)" },
    { id: 5, x: 400, y: 70, r: 2, drift: 24, rise: -32, delay: 1.5, dur: 7.5, color: "rgba(255,248,220,0.88)" },
    { id: 6, x: 480, y: 110, r: 1.5, drift: -26, rise: -40, delay: 3, dur: 8, color: "rgba(58,168,255,0.9)" },
    { id: 7, x: 90, y: 60, r: 1.4, drift: 18, rise: -25, delay: 2.6, dur: 9.5, color: "rgba(255,255,255,0.75)" },
    { id: 8, x: 360, y: 160, r: 2.3, drift: -20, rise: -30, delay: 0.9, dur: 6.8, color: "rgba(46,231,255,0.92)" },
    { id: 9, x: 530, y: 85, r: 1.7, drift: 34, rise: -36, delay: 1.8, dur: 8.2, color: "rgba(180,220,255,0.88)" },
    { id: 10, x: 175, y: 175, r: 1.3, drift: -16, rise: -22, delay: 3.5, dur: 10, color: "rgba(255,255,255,0.7)" }
]

function EmberScene({ glowId, ambientId }: { glowId: string; ambientId: string }) {
    return (
        <g className={styles.scene}>
            <rect fill={`url(#${ambientId})`} width={VB_W} height={VB_H} />
            {EMBERS.map((e) => (
                <circle
                    key={e.id}
                    className={styles.emberParticle}
                    r={e.r}
                    fill={e.color}
                    filter={`url(#${glowId})`}
                    style={particleStyle({
                        "--sx": `${e.x}px`,
                        "--drift": `${e.drift}px`,
                        "--delay": `${e.delay}s`,
                        "--dur": `${e.dur}s`
                    })}
                />
            ))}
        </g>
    )
}

const EMBERS = [
    { id: 1, x: 50, drift: 12, r: 1.8, delay: 0, dur: 5.5, color: "rgba(255,200,120,0.95)" },
    { id: 2, x: 120, drift: -10, r: 1.4, delay: 0.6, dur: 6.2, color: "rgba(255,160,80,0.9)" },
    { id: 3, x: 200, drift: 14, r: 2, delay: 1.2, dur: 5, color: "rgba(255,220,140,0.92)" },
    { id: 4, x: 280, drift: -16, r: 1.6, delay: 0.3, dur: 6.8, color: "rgba(255,180,90,0.88)" },
    { id: 5, x: 350, drift: 11, r: 1.5, delay: 1.8, dur: 5.8, color: "rgba(255,200,110,0.9)" },
    { id: 6, x: 420, drift: -13, r: 2.1, delay: 0.9, dur: 6.5, color: "rgba(255,140,60,0.85)" },
    { id: 7, x: 490, drift: 15, r: 1.3, delay: 2.4, dur: 5.2, color: "rgba(255,210,130,0.92)" },
    { id: 8, x: 90, drift: -9, r: 1.7, delay: 2.1, dur: 7, color: "rgba(255,170,70,0.86)" },
    { id: 9, x: 160, drift: 18, r: 1.2, delay: 3.1, dur: 5.5, color: "rgba(255,190,100,0.8)" },
    { id: 10, x: 240, drift: -14, r: 1.9, delay: 1.5, dur: 6, color: "rgba(255,220,150,0.9)" },
    { id: 11, x: 310, drift: 10, r: 1.4, delay: 3.6, dur: 5.8, color: "rgba(255,150,50,0.82)" },
    { id: 12, x: 380, drift: -11, r: 1.6, delay: 2.8, dur: 6.2, color: "rgba(255,200,120,0.88)" },
    { id: 13, x: 450, drift: 13, r: 1.8, delay: 0.2, dur: 5.4, color: "rgba(255,180,85,0.9)" },
    { id: 14, x: 520, drift: -15, r: 1.5, delay: 3.9, dur: 6.8, color: "rgba(255,210,125,0.85)" }
]
