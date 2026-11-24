function register() {
    process.on("uncaughtException", (err) => {
        console.error("Uncaught exception:", err);
    });
    process.on("unhandledRejection", (reason, p) => {
        console.error("Unhandled rejection:", reason, p);
    });
}

module.exports = { register };
