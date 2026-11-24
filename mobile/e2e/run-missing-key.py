#!/usr/bin/env python3
"""Actual missing local identity, inline continuation and accessible draft/IME checks."""
from __future__ import annotations
import argparse
import importlib.util
from pathlib import Path
import struct
import sys
import time

SPEC = importlib.util.spec_from_file_location('playtime_missing_key_ui', Path(__file__).with_name('run-ui.py'))
assert SPEC and SPEC.loader
UI = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = UI
SPEC.loader.exec_module(UI)
Selector = UI.Selector


class MissingKeySuite(UI.Suite):
    def measure(self) -> None:
        frame = self.ui.run('exec-out', 'screencap', '-p', binary=True)
        self.ui.width, self.ui.height = struct.unpack('>II', frame[16:24])

    def disable_refresh(self) -> None:
        self.ui.run('shell', 'input', 'keyevent', '82')
        refresh = self.ui.wait(Selector(contains='Fast Refresh'))
        if 'Disable' in refresh.attrib.get('text', ''):
            self.ui.tap(Selector(text=refresh.attrib['text']))
        else:
            self.ui.back()

    def missing_identity(self) -> None:
        self.reset()
        self.login()
        original = self.state()
        previous_public = next(user['dmPublicKey'] for user in original['users'] if user['id'] == 1)
        originals = {message['id']: message['content'] for message in original['messages']}
        self.ui.run('shell', 'am', 'force-stop', self.ui.package)
        self.ui.run('shell', 'pm', 'clear', self.ui.package)
        self.ui.run('shell', 'am', 'start', '-n', self.ui.package + '/.MainActivity')
        self.ui.wait(Selector(id='auth-screen'), 45)
        self.disable_refresh()
        self.login()
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.wait(Selector(id='encryption-missing-key-actions'))
        self.ui.wait(Selector(contains='Ключ переписки недоступен'))
        assert self.ui.wait(Selector(id='message-input')).attrib['enabled'] == 'true'
        self.ui.checkpoint('old-history-locked-composer-enabled')
        self.continue_identity()

    def continue_identity(self) -> None:
        original = self.state()
        previous_public = next(user['dmPublicKey'] for user in original['users'] if user['id'] == 1)
        originals = {message['id']: message['content'] for message in original['messages']}
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.wait(Selector(id='encryption-missing-key-actions'))
        self.ui.wait(Selector(contains='Ключ переписки недоступен'))
        self.ui.checkpoint('old-history-locked-composer-available')
        self.ui.run('shell', 'wm', 'size', '720x1280')
        self.ui.run('shell', 'wm', 'density', '320')
        self.ui.run('shell', 'settings', 'put', 'system', 'font_scale', '2.0')
        self.ui.run('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
        self.ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '0')
        time.sleep(1)
        self.measure()
        if self.ui.find(Selector(id='chat-Nova')) is not None:
            self.ui.tap(Selector(id='chat-Nova'))
        self.ui.wait(Selector(id='message-input'))
        text = 'Native encrypted after missing key'
        self.ui.fill(Selector(id='message-input'), text)
        self.ui.checkpoint('missing-key-small-font200-portrait-ime', self.ui.assert_keyboard())
        self.ui.tap(Selector(id='encryption-missing-key-actions'))
        self.ui.wait(Selector(id='encryption-missing-key-sheet'))
        self.ui.wait(Selector(id='encryption-continue-new-key'))
        self.ui.scroll('down')
        self.ui.wait(Selector(description='Восстановить старую историю'))
        self.ui.checkpoint('missing-key-font200-two-actions', self.ui.assert_safe('encryption-continue-new-key'))
        self.ui.back()
        self.ui.fill(Selector(id='message-input'), text)
        self.ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '1')
        time.sleep(1)
        self.measure()
        if self.ui.find(Selector(id='chat-Nova')) is not None:
            self.ui.tap(Selector(id='chat-Nova'))
            self.ui.fill(Selector(id='message-input'), text)
        self.ui.checkpoint('missing-key-small-font200-landscape-ime', self.ui.assert_keyboard())
        self.ui.hide_keyboard()
        self.ui.tap(Selector(id='encryption-missing-key-actions'))
        self.ui.wait(Selector(id='encryption-missing-key-sheet'))
        self.ui.scroll('down')
        self.ui.locate(Selector(id='encryption-continue-new-key'), True)
        self.ui.checkpoint('missing-key-landscape-action-sheet', self.ui.assert_safe('encryption-continue-new-key'))
        self.ui.back()
        self.ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '0')
        self.ui.run('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
        time.sleep(1)
        self.measure()
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.tap(Selector(id='encryption-missing-key-actions'))
        self.ui.tap(Selector(id='encryption-continue-new-key'), True)
        self.ui.wait(Selector(text='Продолжить переписку?'))
        self.ui.checkpoint('new-key-explicit-confirmation')
        self.ui.tap(Selector(id='android:id/button2'))
        assert next(user['dmPublicKey'] for user in self.state()['users'] if user['id'] == 1) == previous_public
        self.ui.tap(Selector(id='encryption-continue-new-key'), True)
        self.ui.tap(Selector(id='android:id/button1'))
        self.ui.wait_absent(Selector(id='encryption-missing-key-actions'))
        self.ui.wait(Selector(text=text))
        self.ui.checkpoint('new-key-preserves-draft-and-locked-history')
        self.ui.tap(Selector(id='message-send'))
        state = self.until(lambda data: any(message['id'] not in originals and message['senderId'] == 1 for message in data['messages']))
        sent = next(message for message in reversed(state['messages']) if message['id'] not in originals and message['senderId'] == 1)
        assert sent['content'].startswith('E2E1:') and text not in sent['content']
        for message_id, ciphertext in originals.items():
            assert next(message['content'] for message in state['messages'] if message['id'] == message_id) == ciphertext
        self.ui.wait(Selector(contains=text))
        self.ui.checkpoint('new-message-encrypted-after-lost-identity')
        self.api('/__test/events', {'action': 'incomingMessage', 'text': 'Fresh reply after identity continuation'})
        self.ui.wait(Selector(contains='Fresh reply after identity continuation'))
        self.ui.checkpoint('new-peer-reply-decrypted-after-continuation')


    def room_recovery(self) -> None:
        import subprocess
        self.home('rooms')
        self.ui.tap(Selector(contains='Вечерний пати'), True)
        self.ui.wait(Selector(contains='пригласить заново'))
        self.ui.fill(Selector(id='message-input'), 'Room after re-invitation', hide=True)
        before = len(self.state()['messages'])
        self.ui.tap(Selector(id='message-send'))
        self.ui.wait(Selector(contains='пригласить заново'))
        assert len(self.state()['messages']) == before
        self.ui.checkpoint('room-old-wrap-explains-reinvite-without-plaintext')
        result = subprocess.run(['node', '--import', 'tsx', 'e2e/provision-reinvited-room.ts'], cwd=UI.ROOT, capture_output=True, text=True)
        assert result.returncode == 0, result.stdout + result.stderr
        self.home('rooms')
        self.ui.tap(Selector(contains='Вечерний пати'), True)
        self.ui.fill(Selector(id='message-input'), 'Room after re-invitation', hide=True)
        self.ui.tap(Selector(id='message-send'))
        state = self.until(lambda data: len(data['messages']) > before)
        assert state['messages'][-1]['content'].startswith('R2E1:')
        self.ui.wait(Selector(contains='Room after re-invitation'))
        self.ui.checkpoint('room-reinvited-current-key-sends-encrypted')

    def peer_scope(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.api('/__test/events', {'action': 'rotatePeerKey', 'username': 'Nova'})
        self.ui.fill(Selector(id='message-input'), 'Nova must still be verified', hide=True)
        before = len(self.state()['messages'])
        self.ui.tap(Selector(id='message-send'))
        self.ui.wait(Selector(description='Проверить ключ'))
        assert len(self.state()['messages']) == before
        self.ui.checkpoint('changed-nova-remains-blocked')
        self.home('chats')
        self.ui.tap(Selector(id='chat-Orbit'))
        self.ui.absent(Selector(description='Проверить ключ'))
        self.ui.fill(Selector(id='message-input'), 'Orbit remains independently encrypted', hide=True)
        self.ui.tap(Selector(id='message-send'))
        state = self.until(lambda data: len(data['messages']) > before)
        assert state['messages'][-1]['content'].startswith('E2E1:')
        self.ui.wait(Selector(contains='Orbit remains independently encrypted'))
        self.ui.checkpoint('changed-nova-does-not-block-orbit')
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.wait(Selector(description='Проверить ключ'))
        assert self.ui.wait(Selector(id='message-input')).attrib['enabled'] == 'false'
        self.ui.checkpoint('nova-still-requires-explicit-trust-after-orbit')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--fixture', default='http://127.0.0.1:1502')
    parser.add_argument('--adb', default=UI.DEFAULT_ADB)
    parser.add_argument('--groups', default='missing_identity,room_recovery,peer_scope')
    args = parser.parse_args()
    ui = UI.AndroidUI(args.adb, args.serial, args.output, 'com.playtimemobile')
    suite = MissingKeySuite(ui, args.fixture)
    try:
        if 'missing_identity' not in args.groups.split(','):
            ui.run('shell', 'am', 'force-stop', ui.package)
            ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
            ui.wait(Selector(id='bottom-navigation'), 45)
        for group in args.groups.split(','):
            suite.run_group(group)
    except Exception as error:
        print(f'FAILED: {error}', file=sys.stderr)
        return 1
    finally:
        ui.run('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
        ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '0')
        ui.run('shell', 'wm', 'size', 'reset')
        ui.run('shell', 'wm', 'density', 'reset')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
