
interface ImportMetaEnv {
    readonly VITE_HERO_STREAM_URL?: string
    readonly VITE_HERO_VIDEO_URL?: string
    readonly VITE_API_BASE?: string
    readonly VITE_PROXY_TARGET?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
