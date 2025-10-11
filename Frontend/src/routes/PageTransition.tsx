import { motion } from "framer-motion"
import React from "react"

const slideVariants = {
    initial: { x: "100%", opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: "-100%", opacity: 0 },
}

type PageTransitionProps = {
    children: React.ReactNode
}

const PageTransition: React.FC<PageTransitionProps> = ({ children }) => (
    <motion.div
        variants={slideVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ duration: 0.5 }}
        style={{ width: "100%", height: "100%" }}
    >
        {children}
    </motion.div>
)

export default PageTransition
