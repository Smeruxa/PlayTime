import type { FriendItem } from "./types"
import { useState } from "react"
import { FaInbox, FaPaperPlane, FaUsers } from "react-icons/fa"
import { useSessionSocket, useOnlineUserIds } from "../../server/socketContext"
import styles from "./Friends.module.css"
import PendingUsers from "../../components/PendingUser/PendingUsers"
import { useFriendsSocket } from "./hooks/useFriendsSocket"
import { FriendsRemoveConfirmModal } from "./FriendsRemoveConfirmModal"
import { useFriendsAvatars } from "./useFriendsAvatars"
import { FriendsAddSection } from "./FriendsAddSection"
import { FriendsAcceptedList } from "./FriendsAcceptedList"
import { FriendsOutgoingList } from "./FriendsOutgoingList"

export default function FriendsPage() {
    const [removeConfirmName, setRemoveConfirmName] = useState<FriendItem | null>(null)
    const { socket, myUserId } = useSessionSocket()
    const onlineUsernames = useOnlineUserIds()

    const {
        friends,
        incomingRequests,
        outgoingRequests,
        message,
        messageType,
        sendRequest,
        acceptRequest,
        declineRequest,
        declineOutgoingRequest,
        blockRequest,
        removeFriend
    } = useFriendsSocket(socket, undefined, myUserId)

    const { avatarByUsername, avatarFor, avatarEffectFor } = useFriendsAvatars(
        socket,
        friends,
        incomingRequests,
        outgoingRequests
    )

    const inCount = incomingRequests.length
    const friendsCount = friends.length
    const outCount = outgoingRequests.length

    return (
        <div className={styles.body}>
            {removeConfirmName != null && (
                <FriendsRemoveConfirmModal
                    username={removeConfirmName.friend_username}
                    onClose={() => setRemoveConfirmName(null)}
                    onConfirm={() => removeFriend(removeConfirmName)}
                />
            )}
            <div className={styles.sheet}>
                <header className={styles.header}>
                    <div className={styles.headerMain}>
                        <h1 className={styles.title}>Друзья</h1>
                        <p className={styles.headerSubtitle}>Заявки и контакты</p>
                    </div>
                </header>

                <div className={styles.addBar}>
                    <FriendsAddSection onSendRequest={sendRequest} message={message} messageType={messageType} />
                </div>

                <div className={styles.mainGrid}>
                    <div className={styles.colRequests}>
                        <section className={styles.block} aria-labelledby="friends-incoming-heading">
                            <div className={styles.blockHead}>
                                <FaInbox className={styles.blockIcon} aria-hidden />
                                <h2 id="friends-incoming-heading" className={styles.blockTitle}>
                                    Входящие
                                </h2>
                                <span className={styles.badge} aria-label={`Входящих: ${inCount}`}>
                                    {inCount}
                                </span>
                            </div>
                            <div className={styles.blockList}>
                                <PendingUsers
                                    users={incomingRequests}
                                    accept={acceptRequest}
                                    decline={declineRequest}
                                    block={blockRequest}
                                    avatarByUsername={avatarByUsername}
                                />
                            </div>
                        </section>

                        <section className={styles.block} aria-labelledby="friends-outgoing-heading">
                            <div className={styles.blockHead}>
                                <FaPaperPlane className={styles.blockIcon} aria-hidden />
                                <h2 id="friends-outgoing-heading" className={styles.blockTitle}>
                                    Исходящие
                                </h2>
                                <span className={styles.badge} aria-label={`Исходящих: ${outCount}`}>
                                    {outCount}
                                </span>
                            </div>
                            <div className={styles.blockList}>
                                <FriendsOutgoingList
                                    outgoingRequests={outgoingRequests}
                                    avatarFor={avatarFor}
                                    avatarEffectFor={avatarEffectFor}
                                    onDeclineOutgoing={declineOutgoingRequest}
                                />
                            </div>
                        </section>
                    </div>

                    <section
                        className={`${styles.block} ${styles.blockFriends}`}
                        aria-labelledby="friends-list-heading"
                    >
                        <div className={styles.blockHead}>
                            <FaUsers className={styles.blockIcon} aria-hidden />
                            <h2 id="friends-list-heading" className={styles.blockTitle}>
                                Ваши друзья
                            </h2>
                            <span className={styles.badge} aria-label={`Друзей: ${friendsCount}`}>
                                {friendsCount}
                            </span>
                        </div>
                        <div className={`${styles.blockList} ${styles.blockListFriends}`}>
                            <FriendsAcceptedList
                                friends={friends}
                                onlineUserIds={onlineUsernames}
                                avatarFor={avatarFor}
                                avatarEffectFor={avatarEffectFor}
                                onRemoveClick={setRemoveConfirmName}
                            />
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}
