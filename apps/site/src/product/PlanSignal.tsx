export default function PlanSignal({ level }: { level: number }) {
    return (
        <svg className="draft-plan-signal" viewBox="0 0 28 24" aria-hidden="true">
            {[7, 11, 16, 21].map((height, index) => (
                <rect
                    key={height}
                    x={index * 7}
                    y={23 - height}
                    width="4"
                    height={height}
                    rx="2"
                    fill="currentColor"
                    opacity={index <= level ? 1 : 0.16}
                />
            ))}
        </svg>
    )
}
