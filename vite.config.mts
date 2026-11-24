import crypto from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

const repoRoot = fileURLToPath(new URL(".", import.meta.url))
const frontendRoot = path.join(repoRoot, "apps", "frontend")

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, repoRoot, "REACT_APP_")
    const nonce = command === "serve" ? crypto.randomBytes(18).toString("base64") : undefined
    return {
        root: frontendRoot,
        envDir: repoRoot,
        base: "./",
        plugins: [
            react(),
            {
                name: "electron-development-csp",
                apply: "serve",
                transformIndexHtml(html) {
                    return html.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)
                }
            }
        ],
        html: { cspNonce: nonce },
        define: {
            "process.env.REACT_APP_WEB_BUILD": JSON.stringify("false"),
            "process.env.REACT_APP_API_BASE": JSON.stringify(env.REACT_APP_API_BASE || ""),
            "process.env.REACT_APP_SOCKET_URL": JSON.stringify(env.REACT_APP_SOCKET_URL || "")
        },
        build: {
            outDir: path.join(repoRoot, "build"),
            emptyOutDir: true,
            target: "chrome130",
            sourcemap: false,
            rolldownOptions: {
                input: [path.join(frontendRoot, "index.html"), path.join(frontendRoot, "incoming-call.html")]
            }
        },
        server: { host: "127.0.0.1", port: 3000, strictPort: true }
    }
})
