import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier/flat"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
    globalIgnores(["dist", "node_modules"]),
    {
        files: ["**/*.{ts,tsx}"],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
        ],
        languageOptions: {
            globals: globals.browser,
        },
        rules: {
            "no-empty": ["error", { allowEmptyCatch: true }],
        },
    },
    {
        files: [
            "src/pages/AdminAuditPage.tsx",
            "src/pages/AdminDashboardPage.tsx",
            "src/pages/AdminReportsPage.tsx",
            "src/pages/AdminSystemPage.tsx",
            "src/pages/AdminTicketsPage.tsx",
            "src/pages/AdminUsersPage.tsx",
            "src/pages/FeedbackPage.tsx",
            "src/pages/ReleasesAdminPage.tsx",
        ],
        rules: {
            "react-hooks/set-state-in-effect": "off",
        },
    },
    {
        files: ["src/billing/useCheckout.ts"],
        rules: {
            "react-hooks/exhaustive-deps": "off",
        },
    },
    eslintConfigPrettier,
])
