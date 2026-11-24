import { useEffect, useState } from "react"
import { IconContext } from "react-icons"
import { FaPhone, FaUsers, FaCog, FaSearch, FaImage, FaBell, FaBellSlash } from "react-icons/fa"
import { E2eeShieldButton } from "./E2eeShieldButton"
import PersonIcon from "../../../components/icons/PersonIcon"
import { AvatarWithEffect } from "../../../pages/Profile/AvatarWithEffect"
import { BannerWithEffect } from "../../../pages/Profile/BannerWithEffect"
import styles from "../../../ui/chat/ChatHeader.module.css"
import type { DmChatHeaderVisual } from "../hooks/useDmPeerHeaderProfile"

type ChatHeaderProps = {
    archived?: boolean
    name: string
    is_room: boolean
    startCallError: string | null
    onStartCall: () => void
    onStartRoomVoice: () => void
    onOpenRoomSettings: () => void
    onOpenFriendProfile?: () => void
    showE2eeShield?: boolean
    peerTypingName?: string | null
    showSearchToggle?: boolean
    searchOpen?: boolean
    onToggleSearch?: () => void
    onOpenDmWallpaper?: () => void
    notifyMuted?: boolean
    onToggleNotifyMute?: () => void
    dmHeaderVisual?: DmChatHeaderVisual | null
}

const ICON_PX = "17px"

export function ChatHeader({
    name,
    archived = false,
    is_room,
    startCallError,
    onStartCall,
    onStartRoomVoice,
    onOpenRoomSettings,
    onOpenFriendProfile,
    showE2eeShield,
    peerTypingName,
    showSearchToggle = false,
    searchOpen = false,
    onToggleSearch,
    onOpenDmWallpaper,
    notifyMuted,
    onToggleNotifyMute,
    dmHeaderVisual
}: ChatHeaderProps) {
    const canProfile = !is_room && !!onOpenFriendProfile && !!name && name !== "Выберите пользователя"
    const canCall = !archived && !is_room && !!name && name !== "Выберите пользователя"
    const canDmWallpaper = canCall && !!onOpenDmWallpaper
    const canNotifyMute = canCall && onToggleNotifyMute != null

    const shield = showE2eeShield ? <E2eeShieldButton /> : null

    const dmHasBannerImg = !!dmHeaderVisual?.profileBanner
    const dmNicInitial = (name.trim().charAt(0) || "?").toUpperCase()
    const [dmAvatarBroken, setDmAvatarBroken] = useState(false)
    const dmAvatarUrl = dmHeaderVisual?.avatar ?? null
    const showDmAvatarImg = Boolean(dmAvatarUrl) && !dmAvatarBroken

    useEffect(() => {
        setDmAvatarBroken(false)
    }, [dmAvatarUrl])

    const dmIdentity =
        dmHeaderVisual !== undefined ? (
            <div
                className={`${styles.chatHeaderDmWrap}${dmHasBannerImg ? ` ${styles.chatHeaderDmWrapHasBanner}` : ""}`}
            >
                <div className={styles.chatHeaderDmBannerAbs} aria-hidden>
                    <BannerWithEffect
                        effect={dmHeaderVisual?.profileBannerEffect ?? "none"}
                        sticker={dmHeaderVisual?.profileBannerSticker ?? "none"}
                        className={styles.chatHeaderDmBannerFx}
                    >
                        <div className={styles.chatHeaderDmBannerMedia}>
                            {dmHeaderVisual?.profileBanner ? (
                                <img
                                    src={dmHeaderVisual.profileBanner}
                                    alt=""
                                    className={styles.chatHeaderDmBannerImg}
                                />
                            ) : (
                                <div className={styles.chatHeaderDmBannerPh} aria-hidden />
                            )}
                        </div>
                    </BannerWithEffect>
                </div>
                <div className={styles.chatHeaderDmRow}>
                    <div className={styles.chatHeaderDmAvatarSlot}>
                        <AvatarWithEffect effect={dmHeaderVisual?.profileAvatarEffect ?? "none"}>
                            {showDmAvatarImg ? (
                                <img
                                    src={dmAvatarUrl!}
                                    alt=""
                                    className={styles.chatHeaderDmAvatarImg}
                                    onError={() => setDmAvatarBroken(true)}
                                />
                            ) : (
                                <span className={styles.chatHeaderDmAvatarInitial} aria-hidden>
                                    {dmNicInitial}
                                </span>
                            )}
                        </AvatarWithEffect>
                    </div>
                    <span
                        className={`${styles.chatHeaderTitle} ${styles.chatHeaderTitleDm} ${styles.chatHeaderTitleFade}`}
                    >
                        {name}
                        {archived ? " · Гость вышел" : ""}
                    </span>
                </div>
            </div>
        ) : (
            <span
                key={`${name}{archived ? " · Гость вышел" : ""}-${is_room}`}
                className={`${styles.chatHeaderTitle} ${styles.chatHeaderTitleFade}`}
            >
                {name}
                {archived ? " · Гость вышел" : ""}
            </span>
        )

    const searchBtn =
        showSearchToggle && onToggleSearch ? (
            <button
                type="button"
                className={`${styles.iconButton} ${searchOpen ? styles.iconButtonSearchOn : ""}`}
                onClick={onToggleSearch}
                title={searchOpen ? "Скрыть поиск" : "Поиск по чату"}
                aria-label="Поиск по чату"
                aria-expanded={searchOpen}
            >
                <FaSearch />
            </button>
        ) : null

    return (
        <header className={styles.chatHeader}>
            <div className={styles.chatHeaderTop}>
                {dmIdentity}
                <div className={styles.chatHeaderIcons}>
                    <IconContext.Provider value={{ size: ICON_PX, style: { display: "block" } }}>
                        {is_room ? (
                            <>
                                <button
                                    type="button"
                                    className={styles.iconButton}
                                    onClick={onStartRoomVoice}
                                    title="Голосовой чат"
                                >
                                    <FaUsers />
                                </button>
                                <button
                                    type="button"
                                    className={styles.iconButton}
                                    onClick={onOpenRoomSettings}
                                    title="Настройки комнаты"
                                >
                                    <FaCog />
                                </button>
                                {searchBtn}
                                {shield}
                            </>
                        ) : (
                            <>
                                {canProfile ? (
                                    <button
                                        type="button"
                                        className={styles.iconButton}
                                        onClick={onOpenFriendProfile}
                                        title="Профиль"
                                    >
                                        <PersonIcon />
                                    </button>
                                ) : null}
                                {canCall ? (
                                    <button
                                        type="button"
                                        className={styles.iconButton}
                                        onClick={onStartCall}
                                        title="Позвонить"
                                    >
                                        <FaPhone />
                                    </button>
                                ) : null}
                                {canDmWallpaper ? (
                                    <button
                                        type="button"
                                        className={styles.iconButton}
                                        onClick={onOpenDmWallpaper}
                                        title="Обои чата"
                                        aria-label="Обои чата"
                                    >
                                        <FaImage />
                                    </button>
                                ) : null}
                                {canNotifyMute ? (
                                    <button
                                        type="button"
                                        className={`${styles.iconButton} ${notifyMuted ? styles.iconButtonMutedOn : ""}`}
                                        onClick={onToggleNotifyMute}
                                        title={
                                            notifyMuted
                                                ? "Уведомления отключены — включить"
                                                : "Отключить уведомления от этого пользователя"
                                        }
                                        aria-label="Уведомления"
                                    >
                                        {notifyMuted ? <FaBellSlash /> : <FaBell />}
                                    </button>
                                ) : null}
                                {searchBtn}
                                {shield}
                            </>
                        )}
                    </IconContext.Provider>
                </div>
            </div>
            {!is_room && startCallError ? (
                <div className={styles.chatHeaderCallBlock}>
                    <span className={styles.callError}>{startCallError}</span>
                </div>
            ) : null}
            {peerTypingName ? <div className={styles.chatHeaderTyping}>{peerTypingName} печатает…</div> : null}
        </header>
    )
}
