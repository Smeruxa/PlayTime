const { runElectronFixture } = require("./lib/electron-fixture.cjs")

process.exitCode = runElectronFixture({
    name: "playtime-viewer-qa",
    prefix: "playtime-viewer-native-",
    main: "screen-viewer-main.cjs",
    renderer: "screen-viewer-renderer.tsx",
    body: '<div id="demo"></div>',
    timeout: 35000
})
