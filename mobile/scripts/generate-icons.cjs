const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '../../apps/frontend/public/assets/PlayTime.png');
const resources = path.resolve(__dirname, '../android/app/src/main/res');
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const masterSize = 1024;
const logoScale = 0.8;
const background = '141414';
if (process.platform !== 'darwin') {
    throw new Error(
        'Regenerate icons on macOS with sips; the committed PNGs work on every build host.',
    );
}
const adaptive = path.join(resources, 'drawable-nodpi');
fs.mkdirSync(adaptive, { recursive: true });
const master = path.join(adaptive, 'playtime_logo.png');
const innerSize = String(Math.round(masterSize * logoScale));
execFileSync(
    '/usr/bin/sips',
    ['-s', 'format', 'png', '-z', innerSize, innerSize, source, '--out', master],
    { stdio: 'pipe' },
);
execFileSync(
    '/usr/bin/sips',
    [
        '-p',
        String(masterSize),
        String(masterSize),
        '--padColor',
        background,
        master,
        '--out',
        master,
    ],
    { stdio: 'pipe' },
);
const generatedMaster = fs.readFileSync(master);
if (
    generatedMaster.readUInt32BE(16) !== masterSize ||
    generatedMaster.readUInt32BE(20) !== masterSize
) {
    throw new Error('The padded icon master must remain 1024 × 1024.');
}
for (const [density, size] of Object.entries(sizes)) {
    const directory = path.join(resources, `mipmap-${density}`);
    fs.mkdirSync(directory, { recursive: true });
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
        execFileSync(
            '/usr/bin/sips',
            [
                '-s',
                'format',
                'png',
                '-z',
                String(size),
                String(size),
                master,
                '--out',
                path.join(directory, name),
            ],
            { stdio: 'pipe' },
        );
    }
}
const storeDirectory = path.resolve(__dirname, '../release/rustore');
fs.mkdirSync(storeDirectory, { recursive: true });
execFileSync(
    '/usr/bin/sips',
    [
        '-s',
        'format',
        'png',
        '-z',
        '512',
        '512',
        master,
        '--out',
        path.join(storeDirectory, 'icon.png'),
    ],
    { stdio: 'pipe' },
);
