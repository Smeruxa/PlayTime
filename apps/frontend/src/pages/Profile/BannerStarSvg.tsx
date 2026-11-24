export function BannerStarSvg({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 32 32" width="32" height="32" aria-hidden focusable="false">
            <polygon
                fill="currentColor"
                points="16,1.6 19.52,11.2 30.4,11.2 21.76,18.24 25.28,29.12 16,22.4 6.72,29.12 10.24,18.24 1.6,11.2 12.48,11.2"
            />
        </svg>
    )
}
