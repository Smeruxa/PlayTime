import React from "react"
import styles from "./TinkoffCard.module.css"

interface TinkoffCardProps {
    accountNumber: string
}

const TinkoffCard: React.FC<TinkoffCardProps> = ({ accountNumber }) => {
    return (
        <div className={styles.tinkoffCard}>
            <div className={styles.tinkoffTitle}>Тинькофф - Алексей С.</div>
            <div className={styles.tinkoffContent}>
                <img src="./assets/tinkoff.png" className={styles.tinkoffLogo} />
                <div className={styles.tinkoffNumber}>{accountNumber}</div>
            </div>
        </div>
    )
}

export default TinkoffCard