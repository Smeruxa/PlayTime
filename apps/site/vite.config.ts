import path from "node:path"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import type { Rule } from "postcss"

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, path.resolve(import.meta.dirname, "."), "")
    const proxyTarget = (env.VITE_PROXY_TARGET || "http://127.0.0.1:1501").replace(/\/$/, "")
    const base = env.VITE_PUBLIC_BASE || "/playtime/"

    return {
        base,
        plugins: [react()],
        resolve: { dedupe: ["react", "react-dom"] },
        css: {
            postcss: {
                plugins: [
                    {
                        postcssPlugin: "scope-application-theme",
                        Rule(rule: Rule) {
                            const source = rule.source?.input.file
                            if (
                                source === path.resolve(import.meta.dirname, "../frontend/src/colors.css") ||
                                source === path.resolve(import.meta.dirname, "../frontend/src/ui/styles/theme.css")
                            ) {
                                rule.selector = rule.selector.replace(/:root(?!:has)/g, ":root:has(.draft-site)")
                            }
                        }
                    }
                ]
            }
        },
        server: {
            proxy: {
                "^/playtime/app(?:/|$)": {
                    target: env.VITE_WEB_DEV_TARGET || "http://127.0.0.1:4176",
                    changeOrigin: true,
                    ws: true
                },
                "^/playtime/(auth|billing|subscription|peers|attachments|voice|releases|downloads|feedback-api|site-analytics|socket\\.io)":
                    {
                        target: proxyTarget,
                        changeOrigin: true,
                        ws: true
                    },
                "^/playtime/admin/(session|access|me|stats|audit|health|users|releases|reports|tickets|visits)": {
                    target: proxyTarget,
                    changeOrigin: true
                }
            }
        }
    }
})
