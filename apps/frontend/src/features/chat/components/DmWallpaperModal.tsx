import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { compressDmWallpaperToDataUrl } from "../../../utils/compressAvatar"
import {
    DM_WALLPAPER_IMAGE_BLUR_DEFAULT,
    DM_WALLPAPER_IMAGE_DIM_DEFAULT,
    DM_WALLPAPER_PRESETS,
    type DmWallpaperState,
    saveDmWallpaper
} from "../dmWallpaperStorage"
import { DmWallpaperAdjustSliders } from "./DmWallpaperAdjustSliders"
import { DmWallpaperImageBackdrop } from "./DmWallpaperImageBackdrop"
import styles from "./DmWallpaperModal.module.css"

type DmWallpaperModalProps = {
    open: boolean
    ownerId?: number | null
    peerUserId?: number
    myUsername: string
    peerUsername: string
    currentWallpaper: DmWallpaperState
    persistWallpaper: (state: DmWallpaperState) => Promise<{ err?: string }>
    onClose: () => void
    onApplied: (state: DmWallpaperState) => void
}

type ImageAdjust = {
    dataUrl: string
    dim: number
    blur: number
}

export function DmWallpaperModal({
    open,
    myUsername,
    ownerId,
    peerUserId,
    peerUsername,
    currentWallpaper,
    persistWallpaper,
    onClose,
    onApplied
}: DmWallpaperModalProps) {
    const fileRef = useRef<HTMLInputElement>(null)
    const [err, setErr] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [imageAdjust, setImageAdjust] = useState<ImageAdjust | null>(null)

    useEffect(() => {
        if (!open) setImageAdjust(null)
    }, [open])

    if (!open) return null

    const commit = async (state: DmWallpaperState) => {
        setBusy(true)
        setErr(null)
        try {
            const { err: saveErr } = await persistWallpaper(state)
            if (saveErr) {
                setErr(saveErr)
                return
            }
            saveDmWallpaper(myUsername, peerUsername, state, ownerId, peerUserId)
            onApplied(state)
            onClose()
        } finally {
            setBusy(false)
        }
    }

    const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        e.target.value = ""
        if (!f || !f.type.startsWith("image/")) return
        setBusy(true)
        setErr(null)
        try {
            const dataUrl = await compressDmWallpaperToDataUrl(f)
            setImageAdjust({
                dataUrl,
                dim: DM_WALLPAPER_IMAGE_DIM_DEFAULT,
                blur: DM_WALLPAPER_IMAGE_BLUR_DEFAULT
            })
        } catch (ex) {
            setErr(ex instanceof Error ? ex.message : "Ошибка")
        } finally {
            setBusy(false)
        }
    }

    const openAdjustFromCurrent = () => {
        if (currentWallpaper.kind !== "image") return
        setImageAdjust({
            dataUrl: currentWallpaper.dataUrl,
            dim: currentWallpaper.dim,
            blur: currentWallpaper.blur
        })
        setErr(null)
    }

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.box} onClick={(ev) => ev.stopPropagation()}>
                <div className={styles.head}>
                    <span className={styles.title}>Обои чата</span>
                    <button type="button" className={styles.closeBtn} onClick={onClose}>
                        Закрыть
                    </button>
                </div>
                <p className={styles.hint}>
                    Общие для вас и <strong>{peerUsername}</strong>: изменения видны у обоих после сохранения на
                    сервере.
                </p>
                {err ? <p className={styles.err}>{err}</p> : null}

                {imageAdjust ? (
                    <>
                        <button
                            type="button"
                            className={styles.btnGhost}
                            onClick={() => setImageAdjust(null)}
                            disabled={busy}
                        >
                            ← К выбору обоев
                        </button>
                        <div className={styles.imagePreviewShell}>
                            <DmWallpaperImageBackdrop
                                dataUrl={imageAdjust.dataUrl}
                                dim={imageAdjust.dim}
                                blur={imageAdjust.blur}
                            />
                        </div>
                        <DmWallpaperAdjustSliders
                            dim={imageAdjust.dim}
                            blur={imageAdjust.blur}
                            disabled={busy}
                            onDimChange={(v) => setImageAdjust((prev) => (prev ? { ...prev, dim: v } : prev))}
                            onBlurChange={(v) => setImageAdjust((prev) => (prev ? { ...prev, blur: v } : prev))}
                        />
                        <div className={styles.row}>
                            <button
                                type="button"
                                className={styles.btnSecondary}
                                onClick={() =>
                                    void commit({
                                        kind: "image",
                                        dataUrl: imageAdjust.dataUrl,
                                        dim: imageAdjust.dim,
                                        blur: imageAdjust.blur
                                    })
                                }
                                disabled={busy}
                            >
                                Применить
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className={styles.presetGrid}>
                            {DM_WALLPAPER_PRESETS.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    className={styles.presetCard}
                                    style={{ backgroundImage: p.gradient }}
                                    onClick={() => void commit({ kind: "preset", id: p.id })}
                                    disabled={busy}
                                >
                                    <span className={styles.presetLabel}>{p.title}</span>
                                </button>
                            ))}
                        </div>
                        <div className={styles.row}>
                            <button
                                type="button"
                                className={styles.btnSecondary}
                                onClick={() => fileRef.current?.click()}
                                disabled={busy}
                            >
                                {busy ? "Обработка…" : "Своё фото"}
                            </button>
                            {currentWallpaper.kind === "image" ? (
                                <button
                                    type="button"
                                    className={styles.btnSecondary}
                                    onClick={openAdjustFromCurrent}
                                    disabled={busy}
                                >
                                    Настроить фото
                                </button>
                            ) : null}
                            <button
                                type="button"
                                className={styles.btnGhost}
                                onClick={() => void commit({ kind: "none" })}
                                disabled={busy}
                            >
                                Сбросить
                            </button>
                        </div>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/jpg"
                            className={styles.hiddenFile}
                            onChange={onPickFile}
                        />
                    </>
                )}
            </div>
        </div>
    )
}
