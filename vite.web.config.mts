import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

const repoRoot = fileURLToPath(new URL(".", import.meta.url))
const frontendRoot = path.join(repoRoot, "apps", "frontend")
const webDist = path.join(repoRoot, "web-dist")
const publicAssets = [
    "assets",
    "font",
    "favicon.ico",
    "logo192.png",
    "logo512.png",
    "manifest.json",
    "robots.txt",
    "recorder-worklet.js",
    "scrollbars.css"
]

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, repoRoot, "WEB_")
    const apiOrigin = command === "build" ? env.WEB_API_ORIGIN?.trim() : undefined
    if (apiOrigin && (new URL(apiOrigin).origin !== apiOrigin || !apiOrigin.startsWith("https://"))) {
        throw new Error("WEB_API_ORIGIN must be an HTTPS origin")
    }
    const nonce = command === "serve" ? crypto.randomBytes(18).toString("base64") : undefined
    const proxyTarget = env.WEB_PROXY_TARGET || "http://127.0.0.1:1501"
    let outputDir = webDist

    return {
        root: frontendRoot,
        envDir: repoRoot,
        base: "/playtime/app/",
        plugins: [
            react(),
            {
                name: "web-development-csp",
                apply: "serve",
                transformIndexHtml(html) {
                    return html.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)
                }
            },
            {
                name: "web-public-assets",
                apply: "build",
                configResolved(config) {
                    outputDir = path.resolve(config.root, config.build.outDir)
                },
                async closeBundle() {
                    await Promise.all(
                        publicAssets.map((asset) =>
                            fs.cp(path.join(frontendRoot, "public", asset), path.join(outputDir, asset), {
                                recursive: true
                            })
                        )
                    )
                }
            }
        ],
        html: { cspNonce: nonce },
        define: {
            "process.env.REACT_APP_WEB_BUILD": JSON.stringify("true"),
            "process.env.REACT_APP_API_BASE": JSON.stringify(`${apiOrigin || ""}/playtime`),
            "process.env.REACT_APP_SOCKET_URL": JSON.stringify(apiOrigin || "")
        },
        build: {
            outDir: webDist,
            emptyOutDir: true,
            copyPublicDir: false,
            target: ["es2022", "chrome109", "firefox115", "safari17"],
            sourcemap: false
        },
        server: {
            host: "127.0.0.1",
            port: 4176,
            strictPort: true,
            watch: { ignored: ["**/mobile/**", "**/apps/site/dist/**", "**/build/**", "**/dist/**"] },
            proxy: {
                "^/playtime/(auth|subscription|peers|attachments|voice|releases|downloads|socket\\.io)": {
                    target: proxyTarget,
                    changeOrigin: true,
                    ws: true
                }
            }
        },
        preview: { host: "127.0.0.1", port: 4176, strictPort: true }
    }
})
