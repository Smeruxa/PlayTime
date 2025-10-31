import styles from "./NavButton.module.css"

export type Button = {
    text: string
    onClick: () => void
}

interface NavButtonProps {
    buttons: Button[]
}

export default function NavButton({ buttons }: NavButtonProps) {
    return (
        <div className={styles.navWrapper}>
            { buttons.map((v, i) => (
               <button
                    key={i}
                    onClick={v.onClick}
                    className={styles.button}
                    style={{
                        borderRadius: i === 0 ? "15px 0 0 0" : i === 1 ? "0" : "0 15px 0 0",
                        ...((i === 1 || i === 2) ? { borderLeft: "none" } : {})
                    }}
                >
                    {v.text}
                </button>
            )) }
        </div>
    )
}