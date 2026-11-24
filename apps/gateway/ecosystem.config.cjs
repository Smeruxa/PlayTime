module.exports = {
    apps: [
        {
            name: "playtime",
            cwd: __dirname,
            script: "node_modules/.bin/tsx",
            args: "server.ts",
            env: {
                NODE_ENV: "production",
            },
            autorestart: true,
            max_restarts: 20,
        },
    ],
}
