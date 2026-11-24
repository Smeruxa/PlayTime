module.exports = {
    root: true,
    ignorePatterns: ["node_modules/", "build/", "dist/", "coverage/"],
    overrides: [
        {
            files: ["apps/frontend/src/**/*.{ts,tsx,js,jsx}"],
            env: { browser: true, es2022: true, jest: true },
            parser: "@typescript-eslint/parser",
            parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
            plugins: ["@typescript-eslint", "react-hooks"],
            extends: ["eslint:recommended", "prettier"],
            rules: {
                "no-undef": "off",
                "no-unused-vars": "off",
                "no-empty": ["error", { allowEmptyCatch: true }],
                "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
                "react-hooks/rules-of-hooks": "error",
                "react-hooks/exhaustive-deps": "warn"
            }
        },
        {
            files: ["apps/{auth-api,chat-api,room-api,gateway,shared,database}/**/*.js"],
            env: { node: true, es2022: true },
            extends: ["eslint:recommended", "plugin:security/recommended-legacy", "prettier"],
            rules: {
                "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }]
            }
        },
        {
            files: ["apps/{auth-api,chat-api,room-api,gateway,shared,database}/**/*.ts"],
            env: { node: true, es2022: true },
            parser: "@typescript-eslint/parser",
            parserOptions: { ecmaVersion: "latest", sourceType: "module" },
            extends: ["eslint:recommended", "plugin:security/recommended-legacy", "prettier"],
            rules: {
                "no-unused-vars": "off",
                "no-empty": ["error", { allowEmptyCatch: true }]
            }
        },
        {
            files: ["apps/room-api/**/*.ts"],
            rules: {
                "no-restricted-imports": [
                    "error",
                    {
                        paths: ["pg", "jsonwebtoken"],
                        patterns: [
                            "**/auth-api/**",
                            "**/chat-api/**",
                            "**/gateway/**",
                            "**/shared/config",
                            "**/shared/deps"
                        ]
                    }
                ]
            }
        },
        {
            files: ["apps/auth-api/**/*.ts"],
            rules: {
                "no-restricted-imports": ["error", { patterns: ["**/chat-api/**", "**/room-api/**", "**/gateway/**"] }]
            }
        },
        {
            files: ["apps/chat-api/**/*.ts"],
            rules: {
                "no-restricted-imports": ["error", { patterns: ["**/auth-api/**", "**/room-api/**", "**/gateway/**"] }]
            }
        },
        {
            files: ["apps/gateway/**/*.ts"],
            excludedFiles: ["apps/gateway/legacy.ts", "apps/gateway/legacy/**", "apps/gateway/tests/**"],
            rules: {
                "no-restricted-imports": ["error", { patterns: ["**/auth-api/**", "**/chat-api/**", "**/room-api/**"] }]
            }
        },
        {
            files: ["apps/shared/**/*.ts"],
            rules: {
                "no-restricted-imports": [
                    "error",
                    { patterns: ["**/auth-api/**", "**/chat-api/**", "**/room-api/**", "**/gateway/**"] }
                ]
            }
        },
        {
            files: ["apps/frontend/public/**/*.js"],
            env: { node: true, browser: true, es2022: true },
            extends: ["eslint:recommended", "prettier"],
            parserOptions: { ecmaVersion: "latest", sourceType: "script" },
            globals: {
                module: "readonly",
                require: "readonly",
                __dirname: "readonly",
                process: "readonly"
            }
        }
    ]
}
