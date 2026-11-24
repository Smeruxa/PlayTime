#!/usr/bin/env python3
"""Real Android key-reset/recovery UI and desktop/native backup interoperability.

Requires the native backup produced by run-ui.py's account scenario. Uses only
the local test account and actual UI; it never injects key state into the app.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time

SOURCE = Path(__file__).with_name('run-ui.py')
SPEC = importlib.util.spec_from_file_location('playtime_key_ui', SOURCE)
assert SPEC and SPEC.loader
UI = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = UI
SPEC.loader.exec_module(UI)
Selector = UI.Selector
REPOSITORY = Path(__file__).resolve().parents[2]


class KeyRecoverySuite(UI.Suite):
    def __init__(self, ui, fixture: str, backup: Path):
        super().__init__(ui, fixture)
        self.backup = backup.resolve()
        self.proof: dict = {}

    def public_key(self) -> str:
        return next(user['dmPublicKey'] for user in self.state()['users'] if user['id'] == 1)

    def account_route(self, route: str) -> None:
        self.home('profile')
        self.ui.tap(Selector(contains='Аккаунт и безопасность'), True)
        self.ui.tap(Selector(id=f'account-{route}'), True)

    def interop(self) -> None:
        wrong = self.ui.output / 'wrong-account-keys.json'
        process = subprocess.run(
            ['node', '--import', 'tsx', 'mobile/e2e/key-backup-interop.ts',
             str(self.backup), str(wrong.resolve())],
            cwd=REPOSITORY, capture_output=True, text=True, check=True,
        )
        self.proof = json.loads(process.stdout)
        assert self.proof['desktopDecryptedNativeBackup']
        assert self.proof['publicKey'] == self.public_key(), 'The supplied backup does not match this test account key'
        self.ui.run('push', str(wrong), '/sdcard/Download/wrong-account-keys.json')
        self.ui.run('push', str(self.backup), '/sdcard/Download/playtime-keys-1.json')
        (self.ui.output / 'desktop-interop.json').write_text(
            json.dumps(self.proof, ensure_ascii=False, indent=4), encoding='utf8',
        )

    def wrong_account(self) -> None:
        previous = self.public_key()
        self.account_route('restore')
        self.ui.tap(Selector(id='keys-select-file'), True)
        self.pick_download('wrong-account-keys.json')
        self.ui.fill(Selector(id='keys-password'), 'Backup-Android-123', hide=True)
        self.ui.tap(Selector(id='keys-submit'), True)
        self.ui.tap(Selector(text='Восстановить'))
        self.ui.wait(Selector(contains='другому аккаунту'), 30)
        assert self.public_key() == previous, 'Rejected foreign backup changed the account key'
        self.ui.checkpoint('wrong-account-backup-rejected')

    def invalid_files(self) -> None:
        previous = self.public_key()
        fixtures = [
            ('oversize-keys.json', ' ' * 256001, 'слишком большой'),
            ('wrong-extension-keys.txt', '{}', 'формате .json'),
        ]
        self.account_route('restore')
        for name, content, message in fixtures:
            file = self.ui.output / name
            file.write_text(content, encoding='utf8')
            self.ui.run('push', str(file), '/sdcard/Download/' + name)
            self.ui.tap(Selector(id='keys-select-file'), True)
            self.pick_download(name)
            self.ui.wait(Selector(contains=message))
            assert self.public_key() == previous
            self.ui.checkpoint(name.replace('.', '-') + '-rejected')
        malformed = self.ui.output / 'malformed-keys.json'
        malformed.write_text('this is not a JSON backup', encoding='utf8')
        self.ui.run('push', str(malformed), '/sdcard/Download/malformed-keys.json')
        self.ui.tap(Selector(id='keys-select-file'), True)
        self.pick_download('malformed-keys.json')
        self.ui.fill(Selector(id='keys-password'), 'Backup-Android-123', hide=True)
        self.ui.tap(Selector(id='keys-submit'), True)
        self.ui.tap(Selector(text='Восстановить'))
        self.ui.wait(Selector(contains='Не удалось открыть копию'), 30)
        assert self.public_key() == previous
        self.ui.checkpoint('malformed-backup-rejected-key-unchanged')

    def unavailable_transfer(self) -> None:
        previous = self.public_key()
        self.account_route('transfer')
        self.ui.tap(Selector(text='На это устройство'))
        self.ui.fill(Selector(id='transfer-input'), '00000000-0000-0000-0000-000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', hide=True)
        self.ui.tap(Selector(id='transfer-receive'), True)
        self.ui.tap(Selector(text='Перенести ключи'))
        self.ui.wait(Selector(contains='Код истёк или уже использован'), 30)
        assert self.public_key() == previous
        self.ui.checkpoint('expired-or-unavailable-transfer-rejected-key-unchanged')

    def reset_restore(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        unique = 'Key recovery retained ciphertext ' + str(int(time.time()))
        self.ui.fill(Selector(id='message-input'), unique)
        self.ui.tap(Selector(id='message-send'))
        self.ui.hide_keyboard()
        self.ui.wait(Selector(contains=unique))
        state = self.state()
        original = state['messages'][-1]
        message_id = original['id']
        ciphertext = original['content']
        assert ciphertext.startswith('E2E1:') and unique not in ciphertext
        old_key = self.public_key()

        self.account_route('restore')
        self.ui.tap(Selector(description='Мой ключ переписки'), True)
        self.ui.wait(Selector(text=self.proof['fingerprint']))
        self.ui.checkpoint('local-key-fingerprint-verified')
        self.ui.tap(Selector(id='keys-reset'), True)
        self.ui.tap(Selector(text='Отмена'))
        assert self.public_key() == old_key, 'Cancelled reset changed the key'
        self.ui.checkpoint('key-reset-cancelled')
        self.ui.tap(Selector(id='keys-reset'), True)
        self.ui.tap(Selector(text='Создать новый ключ'))
        self.until(lambda data: next(user['dmPublicKey'] for user in data['users'] if user['id'] == 1) != old_key)
        self.ui.wait(Selector(contains='Новый ключ создан'), 30)
        self.ui.checkpoint('new-key-explicitly-confirmed')

        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.wait(Selector(contains='Ключ переписки недоступен'), 30)
        self.ui.absent(Selector(contains=unique))
        stored = next(item for item in self.state()['messages'] if item['id'] == message_id)
        assert stored['content'] == ciphertext, 'Reset rewrote historical ciphertext'
        self.ui.checkpoint('old-history-locked-after-reset')

        self.account_route('restore')
        self.ui.tap(Selector(id='keys-select-file'), True)
        self.pick_download('playtime-keys-1.json')
        self.ui.fill(Selector(id='keys-password'), 'Backup-Android-123', hide=True)
        self.ui.tap(Selector(id='keys-submit'), True)
        self.ui.tap(Selector(text='Восстановить'))
        self.ui.wait(Selector(id='keys-done'), 30)
        assert self.public_key() == old_key
        self.ui.tap(Selector(id='keys-done'))
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.wait(Selector(contains=unique), 30)
        self.ui.checkpoint('old-history-decrypted-after-native-backup-restore')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--backup', required=True, type=Path)
    parser.add_argument('--groups', default='interop,wrong_account,reset_restore')
    parser.add_argument('--adb', default=UI.DEFAULT_ADB)
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--fixture', default='http://127.0.0.1:1502')
    parser.add_argument('--output', type=Path, default=Path(__file__).parent / 'artifacts' / ('key-recovery-' + time.strftime('%Y%m%d-%H%M%S')))
    args = parser.parse_args()
    ui = UI.AndroidUI(args.adb, args.serial, args.output, 'com.playtimemobile')
    suite = KeyRecoverySuite(ui, args.fixture, args.backup)
    try:
        for group in args.groups.split(','):
            suite.run_group(group)
    except Exception as error:
        print(f'FAILED: {error}', file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
