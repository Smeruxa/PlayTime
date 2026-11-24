import { useLocation } from "react-router-dom"
import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { useProfilePage } from "./useProfilePage"
import { ProfileFriendPreviewCard } from "./ProfileFriendPreviewCard"
import { ProfileEditorSection } from "./ProfileEditorSection"
import { ProfileAccountTab } from "./ProfileAccountTab"
import { ProfileConfirmMediaModal } from "./ProfileConfirmMediaModal"
import styles from "./Profile.module.css"
import quiet from "./ProfileQuiet.module.css"

type ProfileTab = "profile" | "appearance" | "account"

const TAB_SUBTITLE: Record<ProfileTab, string> = {
    profile: "Статус и превью для друзей",
    appearance: "Аватар, баннер и эффекты",
    account: "Вход, устройства и переписка"
}

export default function ProfilePage() {
    const p = useProfilePage()
    const location = useLocation()
    const [tab, setTab] = useState<ProfileTab>(location.state?.tab === "account" ? "account" : "profile")
    const reduced = useReducedMotion()
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: 0 })
    }, [tab])

    useEffect(() => {
        if (location.state?.tab === "account") setTab("account")
    }, [location.key, location.state?.tab])

    return (
        <div className={`${styles.body} ${quiet.page}`}>
            <div className={`${styles.sheet} ${quiet.sheet}`}>
                <header className={`${styles.header} ${quiet.header}`}>
                    <div className={styles.headerMain}>
                        <h1 className={styles.title}>
                            {tab === "account" ? "Аккаунт" : tab === "appearance" ? "Оформление" : "Профиль"}
                        </h1>
                        <p className={styles.headerSubtitle}>{TAB_SUBTITLE[tab]}</p>
                    </div>
                    <div className={styles.tabBar} role="tablist" aria-label="Разделы профиля">
                        <button
                            type="button"
                            role="tab"
                            id="profile-tab-profile"
                            aria-controls="profile-panel"
                            aria-selected={tab === "profile"}
                            className={`${styles.tabBtn} ${tab === "profile" ? styles.tabBtnActive : ""}`}
                            onClick={() => setTab("profile")}
                        >
                            Профиль
                        </button>
                        <button
                            type="button"
                            role="tab"
                            id="profile-tab-appearance"
                            aria-controls="profile-panel"
                            aria-selected={tab === "appearance"}
                            className={`${styles.tabBtn} ${tab === "appearance" ? styles.tabBtnActive : ""}`}
                            onClick={() => setTab("appearance")}
                        >
                            Оформление
                        </button>
                        <button
                            type="button"
                            role="tab"
                            id="profile-tab-account"
                            aria-controls="profile-panel"
                            aria-selected={tab === "account"}
                            className={`${styles.tabBtn} ${tab === "account" ? styles.tabBtnActive : ""}`}
                            onClick={() => setTab("account")}
                        >
                            Аккаунт
                        </button>
                    </div>
                </header>

                <input
                    ref={p.fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/jpg"
                    className={styles.hiddenFile}
                    onChange={p.onPickAvatar}
                />
                <input
                    ref={p.bannerFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/jpg"
                    className={styles.hiddenFile}
                    onChange={p.onPickBanner}
                />

                <div ref={scrollRef} className={`${styles.scroll} ${quiet.scroll}`}>
                    {p.loadErr ? <div className={styles.loadErr}>{p.loadErr}</div> : null}
                    <motion.div
                        key={tab}
                        id="profile-panel"
                        role="tabpanel"
                        aria-labelledby={`profile-tab-${tab}`}
                        initial={reduced ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: reduced ? 0 : 0.18 }}
                    >
                        {tab === "profile" && (
                            <ProfileFriendPreviewCard
                                username={p.username}
                                createdAt={p.createdAt}
                                status={p.status}
                                bio={p.bio}
                                avatarPreview={p.avatarPreview}
                                bannerUrl={p.bannerPreview}
                                bannerEffect={p.bannerEffect}
                                bannerSticker={p.bannerSticker}
                                avatarEffect={p.avatarEffect}
                                profileBannerAllowed={p.profileBannerAllowed}
                                profileBannerEffectsAllowed={p.profileBannerEffectsAllowed}
                                planLimits={p.planLimits}
                                hasUnsavedChanges={p.dirty}
                                disabled={p.saving}
                                onEditAvatar={p.openAvatarPicker}
                                onEditBanner={p.openBannerPicker}
                                onStatusChange={p.setStatus}
                                onBioChange={p.setBio}
                            />
                        )}

                        {tab === "appearance" && (
                            <ProfileEditorSection
                                username={p.username}
                                status={p.status}
                                bio={p.bio}
                                createdAt={p.createdAt}
                                hasUnsavedChanges={p.dirty}
                                avatarPreview={p.avatarPreview}
                                bannerPreview={p.bannerPreview}
                                planSlug={p.planSlug}
                                planLimits={p.planLimits}
                                profileBannerAllowed={p.profileBannerAllowed}
                                profileBannerEffectsAllowed={p.profileBannerEffectsAllowed}
                                avatarEffectsAllowed={p.avatarEffectsAllowed}
                                avatarEffect={p.avatarEffect}
                                bannerEffect={p.bannerEffect}
                                bannerSticker={p.bannerSticker}
                                disabled={p.saving || !p.username}
                                onAvatarEffectChange={p.setAvatarEffect}
                                onBannerEffectChange={p.setBannerEffect}
                                onBannerStickerChange={p.setBannerSticker}
                                onEditAvatar={p.openAvatarPicker}
                                onEditBanner={p.openBannerPicker}
                                onRemoveAvatar={p.requestRemoveAvatar}
                                onRemoveBanner={p.requestRemoveBanner}
                            />
                        )}

                        {tab === "account" && (
                            <ProfileAccountTab
                                currentPassword={p.currentPassword}
                                password={p.password}
                                passwordRepeat={p.passwordRepeat}
                                errorPassword={p.errorPassword}
                                successPassword={p.successPassword}
                                passwordSaving={p.passwordSaving}
                                deleteAccountPassword={p.deleteAccountPassword}
                                deleteAccountErr={p.deleteAccountErr}
                                deletingAccount={p.deletingAccount}
                                socketConnected={!!p.socket?.connected}
                                onCurrentChange={(e) => p.setCurrentPassword(e.target.value)}
                                onNewChange={(e) => p.setPassword(e.target.value)}
                                onRepeatChange={(e) => p.setRepeatPassword(e.target.value)}
                                onChangePassword={p.changePassword}
                                onResetPassword={p.resetPasswordForm}
                                onResetDelete={p.resetDeleteForm}
                                onDeletePasswordChange={(e) => {
                                    p.setDeleteAccountPassword(e.target.value)
                                    p.setDeleteAccountErr(null)
                                }}
                                onHoldComplete={p.onDeleteHoldComplete}
                            />
                        )}
                    </motion.div>
                </div>

                {tab !== "account" && (p.dirty || p.saveMsg) ? (
                    <div className={styles.stickySaveBar}>
                        <p
                            className={[
                                styles.stickySaveNote,
                                p.saveMsg && !p.saveMsgIsError ? styles.stickySaveStatusOk : "",
                                p.saveMsg && p.saveMsgIsError ? styles.stickySaveStatusErr : ""
                            ]
                                .filter(Boolean)
                                .join(" ")}
                            role="status"
                        >
                            {p.saveMsg ?? "Есть несохранённые изменения"}
                        </p>
                        {p.dirty ? (
                            <div className={styles.saveActions}>
                                {tab === "appearance" ? (
                                    <button
                                        type="button"
                                        className={styles.btnDiscard}
                                        disabled={p.saving}
                                        onClick={p.discardProfileChanges}
                                    >
                                        Отменить
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className={styles.btnPrimary}
                                    disabled={p.saving}
                                    onClick={p.saveProfile}
                                >
                                    {p.saving ? "Сохранение…" : "Сохранить"}
                                </button>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {p.avatarConfirmOpen && p.pendingAvatarUrl ? (
                <ProfileConfirmMediaModal
                    kind="avatar"
                    previewUrl={p.pendingAvatarUrl}
                    saving={p.saving}
                    error={p.saveMsgIsError ? p.saveMsg : null}
                    onConfirm={p.confirmAvatarSave}
                    onCancel={p.cancelAvatarSave}
                />
            ) : null}
            {p.bannerConfirmOpen && p.pendingBannerUrl ? (
                <ProfileConfirmMediaModal
                    kind="banner"
                    previewUrl={p.pendingBannerUrl}
                    saving={p.saving}
                    error={p.saveMsgIsError ? p.saveMsg : null}
                    onConfirm={p.confirmBannerSave}
                    onCancel={p.cancelBannerSave}
                />
            ) : null}
        </div>
    )
}
