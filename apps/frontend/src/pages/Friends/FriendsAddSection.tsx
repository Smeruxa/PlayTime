import { InviteField } from "../../ui/primitives/InviteField"
import styles from "./Friends.module.css"

type FriendsAddSectionProps = {
    onSendRequest: (name: string) => void
    message: string | null
    messageType: number
}

export function FriendsAddSection({ onSendRequest, message, messageType }: FriendsAddSectionProps) {
    return (
        <>
            <InviteField onSubmit={onSendRequest} placeholder="Введите никнейм" />
            {message ? <p className={messageType === 0 ? styles.feedbackOk : styles.feedbackErr}>{message}</p> : null}
        </>
    )
}
