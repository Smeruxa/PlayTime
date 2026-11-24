import { native, pickFile } from '../src/platform/device';
import { saveKeyBackup, selectKeyBackup } from '../src/features/account/files';
import util from 'tweetnacl-util';

jest.mock('../src/platform/device', () => ({
    native: { saveDocument: jest.fn() },
    pickFile: jest.fn(),
    isCancelled: (error: unknown) => error instanceof Error && /cancel/i.test(error.message),
}));

beforeEach(() => jest.clearAllMocks());

test('cancelled Android save dialog never reports a completed backup', async () => {
    jest.mocked(native.saveDocument).mockResolvedValue(null);
    expect(await saveKeyBackup(7, '{"keys":"секрет"}')).toBe(false);
    const [, payload] = jest.mocked(native.saveDocument).mock.calls[0];
    expect(util.encodeUTF8(util.decodeBase64(payload))).toBe('{"keys":"секрет"}');
});

test('cancelled Android document picker keeps the current key untouched', async () => {
    jest.mocked(pickFile).mockResolvedValue(null);
    expect(await selectKeyBackup()).toBeNull();
});

test('oversized backups are rejected even when file metadata understates their size', async () => {
    jest.mocked(pickFile).mockResolvedValue({
        uri: 'content://test/copy',
        name: 'keys.json',
        mime: 'application/json',
        size: 1,
        base64: util.encodeBase64(new Uint8Array(256001)),
    });
    await expect(selectKeyBackup()).rejects.toThrow('Не удалось прочитать копию');
});

test('only explicit JSON backup files can be imported', async () => {
    jest.mocked(pickFile).mockResolvedValue({
        uri: 'content://test/picture',
        name: 'photo.jpg',
        mime: 'image/jpeg',
        size: 1,
        base64: 'AA==',
    });
    await expect(selectKeyBackup()).rejects.toThrow('формате .json');
});
