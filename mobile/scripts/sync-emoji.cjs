const fs = require('node:fs');
const path = require('node:path');

const desktop = path.resolve(
    __dirname,
    '../../apps/frontend/src/features/chat/emoji/emojiDataset.ts',
);
const source = fs.readFileSync(desktop, 'utf8');
const pack = source.match(/const PACK = \[([\s\S]+?)\]\.join/);
if (!pack) {
    throw new Error('Desktop emoji dataset shape changed; update the generator.');
}
const groups = Array.from(pack[1].matchAll(/"([^"]+)"/g), (match) => match[1]);
const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
const emoji = [
    ...new Set(Array.from(segmenter.segment(groups.join('')), (entry) => entry.segment)),
];
const output = path.resolve(__dirname, '../src/features/chat/emojiCatalog.ts');
fs.writeFileSync(
    output,
    [`export const EMOJI_CATALOG: readonly string[] = ${JSON.stringify(emoji, null, 4)};`, ''].join(
        '\n',
    ),
);
console.log(`Synced ${emoji.length} desktop emoji.`);
