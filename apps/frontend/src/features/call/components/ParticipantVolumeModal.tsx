import { createPortal } from "react-dom"
import { Modal } from "../../../ui/overlays/Modal"
import { Button } from "../../../ui/primitives/Button"
import { CallVolumeControl } from "./CallVolumeControl"
import styles from "./ParticipantVolumeModal.module.css"

type Props = {
    username: string
    value: number
    onChange: (percent: number) => void
    onClose: () => void
}

export function ParticipantVolumeModal({ username, value, onChange, onClose }: Props) {
    return createPortal(
        <Modal
            open
            title={`Громкость: ${username}`}
            onClose={onClose}
            panelClassName={styles.panel}
            footer={
                <Button type="button" variant="primary" onClick={onClose}>
                    Готово
                </Button>
            }
        >
            <p className={styles.hint}>
                Настройка только для вас — остальные участники её не видят. ПКМ по участнику в голосовом чате.
            </p>
            <CallVolumeControl
                wide
                value={value}
                onChange={onChange}
                ariaLabel={`Громкость ${username}`}
                className={styles.volumeControl}
            />
        </Modal>,
        document.body
    )
}
