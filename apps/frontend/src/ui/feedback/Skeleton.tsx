import styles from "./Skeleton.module.css"

type SkeletonProps = {
    className?: string
    width?: string | number
    height?: string | number
}

export function Skeleton({ className, width, height }: SkeletonProps) {
    return <span className={[styles.bone, className].filter(Boolean).join(" ")} style={{ width, height }} aria-hidden />
}
