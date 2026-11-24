const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const directory = path.resolve(__dirname, '../release/rustore');
const listing = JSON.parse(fs.readFileSync(path.join(directory, 'listing.ru.json'), 'utf8'));
const screenshots = JSON.parse(fs.readFileSync(path.join(directory, 'screenshots.json'), 'utf8'));

for (const [field, limit] of [
    ['name', 30],
    ['shortDescription', 80],
    ['fullDescription', 4000],
]) {
    assert.equal(typeof listing[field], 'string', `${field} must be text`);
    assert.ok(
        listing[field].length > 0 && listing[field].length <= limit,
        `${field}: limit ${limit}`,
    );
}

function inspectPng(filename, maximumBytes) {
    const data = fs.readFileSync(path.join(directory, filename));
    assert.equal(
        data.subarray(0, 8).toString('hex'),
        '89504e470d0a1a0a',
        `${filename}: PNG required`,
    );
    assert.ok(data.length <= maximumBytes, `${filename}: file is too large`);
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

assert.deepEqual(inspectPng('icon.png', 3_000_000), { width: 512, height: 512 });
assert.ok(screenshots.length >= 3 && screenshots.length <= 10, 'Provide 3–10 phone screenshots');
for (const screenshot of screenshots) {
    const { width, height } = inspectPng(screenshot.file, 3_000_000);
    assert.ok(width <= 2160 && height <= 3840, `${screenshot.file}: excessive resolution`);
    assert.equal(width * 16, height * 9, `${screenshot.file}: expected portrait 9:16`);
    assert.ok(screenshot.source && screenshot.description, 'Record screenshot provenance');
}

process.stdout.write(
    `RuStore metadata, icon and ${screenshots.length} phone screenshots validated.\n`,
);
