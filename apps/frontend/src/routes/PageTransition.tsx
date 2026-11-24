import { motion, useReducedMotion } from "framer-motion"
import React from "react"

const transition = {
    type: "tween" as const,
    duration: 0.22,
    ease: [0.32, 0.72, 0, 1] as const
}

const variants = {
    initial: { opacity: 0, x: 10 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -8 }
}

const variantsReduced = {
    initial: { opacity: 0.96 },
    animate: { opacity: 1 },
    exit: { opacity: 1 }
}

type PageTransitionProps = {
    children: React.ReactNode
}

const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
    const reduced = useReducedMotion()
    return (
    <motion.div
        variants={reduced ? variantsReduced : variants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={reduced ? { duration: 0.01 } : transition}
        style={{
            width: "100%",
            height: "100%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column"
        }}
    >
        {children}
    </motion.div>
    )
}

export default PageTransition
