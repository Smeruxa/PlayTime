const { runElectronFixture } = require("./lib/electron-fixture.cjs")

const systemAudio = process.argv.includes("--system-audio")
if (systemAudio && process.platform !== "darwin") {
    throw new Error("The native system-audio test uses macOS afplay. Run without --system-audio for the WebRTC transport test.")
}

process.exitCode = runElectronFixture({
    name: "playtime-screen-test",
    prefix: "playtime-screen-test-",
    main: "screen-share-main.cjs",
    renderer: "screen-share-renderer.tsx",
    body: '<div id="screen-a"></div><div id="screen-b"></div>',
    timeout: 90000,
    env: {
        PLAYTIME_TEST_SYSTEM_AUDIO: systemAudio ? "1" : "0",
        PLAYTIME_TEST_DIRECT: process.argv.includes("--direct") ? "1" : "0"
    }
})
