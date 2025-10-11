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
                <div className={styles.tinkoffLogo}>
                    <div className={styles.shield}>
                        <div className={`${styles.stripe} ${styles.stripe1}`}></div>
                        <div className={`${styles.stripe} ${styles.stripe2}`}></div>
                        <div className={`${styles.stripe} ${styles.stripe3}`}></div>
                    </div>
                </div>
                <div className={styles.tinkoffNumber}>{accountNumber}</div>
            </div>
        </div>
    )
}

export default TinkoffCard