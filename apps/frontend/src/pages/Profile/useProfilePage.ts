import { passwordPolicyError } from "../../../../shared/auth/passwordPolicy"
import { useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent } from "react"
import type { UserPublicProfile } from "../../types"
import { compressAvatarToDataUrl, compressProfileBannerToDataUrl } from "../../utils/compressAvatar"
import { useSessionSocket } from "../../server/socketContext"
import type { AvatarMode } from "./profileTypes"
import { normalizeAvatarEffect } from "../../profile/avatarEffects"
import { normalizeBannerEffect } from "../../profile/bannerEffects"
import { visibleAvatarEffect, visibleBannerEffect } from "../../../../shared/subscription/profileCustomization"

type SavedSnapshot = {
    status: string
    bio: string
    avatarEffect: string
    bannerEffect: string
    bannerSticker: string
    avatarMode: AvatarMode
    bannerMode: AvatarMode
}

export function useProfilePage() {
    const { socket, logout, planLimits, planSlug } = useSessionSocket()
    const fileRef = useRef<HTMLInputElement>(null)
    const bannerFileRef = useRef<HTMLInputElement>(null)
    const saveMsgTimerRef = useRef<number | undefined>(undefined)

    useEffect(() => () => window.clearTimeout(saveMsgTimerRef.current), [])

    const [username, setUsername] = useState("")
    const [email, setEmail] = useState("")
    const [status, setStatus] = useState("")
    const [bio, setBio] = useState("")
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
    const [avatarMode, setAvatarMode] = useState<AvatarMode>("unchanged")
    const [bannerPreview, setBannerPreview] = useState<string | null>(null)
    const [bannerMode, setBannerMode] = useState<AvatarMode>("unchanged")
    const [avatarEffect, setAvatarEffect] = useState("none")
    const [bannerEffect, setBannerEffect] = useState("none")
    const [bannerSticker, setBannerSticker] = useState("none")
    const [createdAt, setCreatedAt] = useState("")
    const [loadErr, setLoadErr] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [saveMsg, setSaveMsg] = useState<string | null>(null)
    const [saveMsgIsError, setSaveMsgIsError] = useState(false)

    const [avatarConfirmOpen, setAvatarConfirmOpen] = useState(false)
    const [bannerConfirmOpen, setBannerConfirmOpen] = useState(false)
    const [pendingAvatarUrl, setPendingAvatarUrl] = useState<string | null>(null)
    const [pendingBannerUrl, setPendingBannerUrl] = useState<string | null>(null)

    const [saved, setSaved] = useState<SavedSnapshot | null>(null)

    const [currentPassword, setCurrentPassword] = useState("")
    const [password, setPassword] = useState("")
    const [passwordRepeat, setRepeatPassword] = useState("")

    const [errorPassword, setErrorPassword] = useState<string | null>(null)
    const [successPassword, setSuccessPassword] = useState<string | null>(null)
    const [passwordSaving, setPasswordSaving] = useState(false)

    const [deleteAccountPassword, setDeleteAccountPassword] = useState("")
    const [deleteAccountErr, setDeleteAccountErr] = useState<string | null>(null)
    const [deletingAccount, setDeletingAccount] = useState(false)

    const applySnapshotFromProfile = useCallback((p: UserPublicProfile) => {
        setUsername(p.username)
        setEmail(p.email ?? "")
        setStatus(p.status)
        setBio(p.bio)
        setAvatarPreview(p.avatar)
        setAvatarMode("unchanged")
        setBannerPreview(p.profileBanner ?? null)
        setBannerMode("unchanged")
        setAvatarEffect(normalizeAvatarEffect(p.profileAvatarEffect))
        setBannerEffect(normalizeBannerEffect(p.profileBannerEffect))
        setBannerSticker(p.profileBannerSticker ?? "none")
        setCreatedAt(p.createdAt)
        setSaved({
            status: p.status,
            bio: p.bio,
            avatarEffect: normalizeAvatarEffect(p.profileAvatarEffect),
            bannerEffect: normalizeBannerEffect(p.profileBannerEffect),
            bannerSticker: p.profileBannerSticker ?? "none",
            avatarMode: "unchanged",
            bannerMode: "unchanged"
        })
    }, [])

    const loadProfile = useCallback(
        (onLoaded?: () => void) => {
            if (!socket) {
                onLoaded?.()
                return
            }
            setLoadErr(null)
            socket.emit("profile:get", {}, (res: { profile?: UserPublicProfile; err?: string }) => {
                if (res.err) setLoadErr(res.err)
                else if (res.profile) applySnapshotFromProfile(res.profile)
                onLoaded?.()
            })
        },
        [socket, applySnapshotFromProfile]
    )

    useEffect(() => {
        loadProfile()
    }, [loadProfile])

    const dirty =
        saved != null &&
        (status !== saved.status ||
            bio !== saved.bio ||
            avatarEffect !== saved.avatarEffect ||
            bannerEffect !== saved.bannerEffect ||
            bannerSticker !== saved.bannerSticker ||
            avatarMode !== saved.avatarMode ||
            bannerMode !== saved.bannerMode)

    const pendingAppearance = useMemo(
        () => ({
            ...(avatarEffect !== saved?.avatarEffect && visibleAvatarEffect(planLimits, avatarEffect) === avatarEffect
                ? { profileAvatarEffect: avatarEffect }
                : {}),
            ...(bannerEffect !== saved?.bannerEffect && visibleBannerEffect(planLimits, bannerEffect) === bannerEffect
                ? { profileBannerEffect: bannerEffect }
                : {}),
            ...(bannerSticker !== saved?.bannerSticker &&
            (planLimits?.profileBannerEffectsAllowed || bannerSticker === "none")
                ? { profileBannerSticker: bannerSticker }
                : {})
        }),
        [saved, avatarEffect, bannerEffect, bannerSticker, planLimits]
    )

    const emitProfileUpdate = useCallback(
        (
            payload: {
                status: string
                bio: string
                avatar?: string | null
                profileBanner?: string | null
                profileAvatarEffect?: string
                profileBannerEffect?: string
                profileBannerSticker?: string
            },
            onDone?: () => void
        ) => {
            if (!socket) return
            window.clearTimeout(saveMsgTimerRef.current)
            setSaving(true)
            setSaveMsg(null)
            setSaveMsgIsError(false)
            socket.emit("profile:update", payload, (res: { success?: boolean; err?: string }) => {
                if (res.success) {
                    loadProfile(() => {
                        setSaving(false)
                        setSaveMsg("Сохранено")
                        window.dispatchEvent(new Event("playtime:refresh-friend-avatars"))
                        onDone?.()
                        saveMsgTimerRef.current = window.setTimeout(() => setSaveMsg(null), 2500)
                    })
                } else {
                    setSaving(false)
                    setSaveMsgIsError(true)
                    setSaveMsg(res.err || "Ошибка сохранения")
                }
            })
        },
        [socket, loadProfile]
    )

    const saveProfile = useCallback(() => {
        if (!socket || !saved) return
        const payload: {
            status: string
            bio: string
            avatar?: string | null
            profileBanner?: string | null
            profileAvatarEffect?: string
            profileBannerEffect?: string
            profileBannerSticker?: string
        } = { status, bio, ...pendingAppearance }

        if (avatarMode === "new" && avatarPreview) payload.avatar = avatarPreview
        else if (avatarMode === "cleared") payload.avatar = ""

        if (planLimits?.profileBannerAllowed) {
            if (bannerMode === "new" && bannerPreview) payload.profileBanner = bannerPreview
            else if (bannerMode === "cleared") {
                payload.profileBanner = ""
                payload.profileBannerEffect = "none"
                payload.profileBannerSticker = "none"
            }
        }

        emitProfileUpdate(payload)
    }, [
        socket,
        saved,
        status,
        bio,
        avatarMode,
        avatarPreview,
        bannerMode,
        bannerPreview,
        planLimits?.profileBannerAllowed,
        pendingAppearance,
        emitProfileUpdate
    ])

    const changePassword = () => {
        if (!socket?.connected || passwordSaving) return

        const u = (s: string) => {
            setErrorPassword(s)
            setSuccessPassword(null)
        }

        if (!currentPassword) return u("Введите текущий пароль")
        if (!password || !passwordRepeat) return u("Заполните новый пароль и повтор")
        if (password !== passwordRepeat) return u("Новые пароли не совпадают")
        const policyError = passwordPolicyError(password)
        if (policyError) return u(policyError)

        setPasswordSaving(true)
        setErrorPassword(null)
        setSuccessPassword(null)
        socket.emit(
            "user:changePassword",
            { currentPassword, newPassword: password },
            (res: { success: boolean; err?: string }) => {
                setPasswordSaving(false)
                if (res.success) {
                    setErrorPassword(null)
                    setSuccessPassword("Пароль изменён")
                    setCurrentPassword("")
                    setPassword("")
                    setRepeatPassword("")
                } else {
                    setErrorPassword("Ошибка: " + res.err)
                }
            }
        )
    }

    const onPickAvatar = async (e: ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        e.target.value = ""
        if (!f || !f.type.startsWith("image/")) return
        window.clearTimeout(saveMsgTimerRef.current)
        setSaveMsg(null)
        try {
            const url = await compressAvatarToDataUrl(f)
            setPendingAvatarUrl(url)
            setAvatarConfirmOpen(true)
        } catch (err) {
            setSaveMsgIsError(true)
            setSaveMsg(err instanceof Error ? err.message : "Ошибка обработки фото")
        }
    }

    const confirmAvatarSave = useCallback(() => {
        if (!pendingAvatarUrl || !saved) return
        emitProfileUpdate({ status, bio, ...pendingAppearance, avatar: pendingAvatarUrl }, () => {
            setAvatarConfirmOpen(false)
            setPendingAvatarUrl(null)
        })
    }, [pendingAvatarUrl, saved, status, bio, pendingAppearance, emitProfileUpdate])

    const cancelAvatarSave = useCallback(() => {
        setAvatarConfirmOpen(false)
        setPendingAvatarUrl(null)
    }, [])

    const requestRemoveAvatar = useCallback(() => {
        if (!saved || !window.confirm("Убрать фото профиля? Друзья увидят заглушку.")) return
        emitProfileUpdate({ status, bio, ...pendingAppearance, avatar: "" })
    }, [saved, status, bio, pendingAppearance, emitProfileUpdate])

    const onPickBanner = async (e: ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        e.target.value = ""
        if (!f || !f.type.startsWith("image/")) return
        window.clearTimeout(saveMsgTimerRef.current)
        setSaveMsg(null)
        try {
            const url = await compressProfileBannerToDataUrl(f)
            setPendingBannerUrl(url)
            setBannerConfirmOpen(true)
        } catch (err) {
            setSaveMsgIsError(true)
            setSaveMsg(err instanceof Error ? err.message : "Ошибка обработки баннера")
        }
    }

    const confirmBannerSave = useCallback(() => {
        if (!pendingBannerUrl || !saved) return
        emitProfileUpdate({ status, bio, ...pendingAppearance, profileBanner: pendingBannerUrl }, () => {
            setBannerConfirmOpen(false)
            setPendingBannerUrl(null)
        })
    }, [pendingBannerUrl, saved, status, bio, pendingAppearance, emitProfileUpdate])

    const cancelBannerSave = useCallback(() => {
        setBannerConfirmOpen(false)
        setPendingBannerUrl(null)
    }, [])

    const requestRemoveBanner = useCallback(() => {
        if (!planLimits?.profileBannerAllowed || !saved) return
        if (!window.confirm("Убрать баннер профиля?")) return
        emitProfileUpdate({
            status,
            bio,
            ...pendingAppearance,
            profileBanner: "",
            profileBannerEffect: "none",
            profileBannerSticker: "none"
        })
    }, [planLimits?.profileBannerAllowed, saved, status, bio, pendingAppearance, emitProfileUpdate])

    const onDeleteHoldComplete = () => {
        if (!socket?.connected || deletingAccount) return
        const pwd = deleteAccountPassword
        if (!pwd.trim()) return
        setDeletingAccount(true)
        socket.emit(
            "user:deleteAccount",
            { password: pwd },
            (res: { success?: boolean; err?: string; locked?: boolean }) => {
                setDeletingAccount(false)
                if (res?.success) {
                    setDeleteAccountErr(null)
                    logout()
                    return
                }
                setDeleteAccountErr(res?.err || "Не удалось удалить аккаунт")
                if (res?.locked) logout()
            }
        )
    }

    const profileBannerAllowed = planLimits?.profileBannerAllowed ?? false
    const profileBannerEffectsAllowed = planLimits?.profileBannerEffectsAllowed ?? false
    const avatarEffectsAllowed = planLimits?.avatarEffectsAllowed ?? false

    return {
        fileRef,
        bannerFileRef,
        username,
        email,
        status,
        setStatus,
        bio,
        setBio,
        avatarPreview,
        bannerPreview,
        profileBannerAllowed,
        profileBannerEffectsAllowed,
        avatarEffectsAllowed,
        avatarEffect,
        setAvatarEffect,
        bannerEffect,
        setBannerEffect,
        bannerSticker,
        setBannerSticker,
        createdAt,
        loadErr,
        saving,
        saveMsg,
        saveMsgIsError,
        dirty,
        planSlug,
        planLimits,
        currentPassword,
        setCurrentPassword,
        password,
        setPassword,
        passwordRepeat,
        setRepeatPassword,
        errorPassword,
        successPassword,
        passwordSaving,
        resetPasswordForm: () => {
            setCurrentPassword("")
            setPassword("")
            setRepeatPassword("")
            setErrorPassword(null)
            setSuccessPassword(null)
        },
        deleteAccountPassword,
        setDeleteAccountPassword,
        deleteAccountErr,
        deletingAccount,
        resetDeleteForm: () => {
            setDeleteAccountPassword("")
            setDeleteAccountErr(null)
        },
        setDeleteAccountErr,
        changePassword,
        onPickAvatar,
        onPickBanner,
        saveProfile,
        discardProfileChanges: () => {
            if (!saved || saving) return
            setStatus(saved.status)
            setBio(saved.bio)
            setAvatarEffect(saved.avatarEffect)
            setBannerEffect(saved.bannerEffect)
            setBannerSticker(saved.bannerSticker)
            setAvatarMode(saved.avatarMode)
            setBannerMode(saved.bannerMode)
            window.clearTimeout(saveMsgTimerRef.current)
            setSaveMsg(null)
            setSaveMsgIsError(false)
        },
        onDeleteHoldComplete,
        socket,
        openAvatarPicker: () => fileRef.current?.click(),
        openBannerPicker: () => bannerFileRef.current?.click(),
        avatarConfirmOpen,
        bannerConfirmOpen,
        pendingAvatarUrl,
        pendingBannerUrl,
        confirmAvatarSave,
        cancelAvatarSave,
        confirmBannerSave,
        cancelBannerSave,
        requestRemoveAvatar,
        requestRemoveBanner
    }
}
