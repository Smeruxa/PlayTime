const { runElectronFixture } = require("./lib/electron-fixture.cjs")

process.exitCode = runElectronFixture({
    name: "playtime-mesh-test",
    prefix: "playtime-mesh-",
    main: "mesh-benchmark-main.cjs",
    renderer: "mesh-benchmark-renderer.ts",
    timeout: 120000
})
