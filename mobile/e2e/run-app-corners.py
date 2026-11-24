#!/usr/bin/env python3
"""Native account lifecycle, validation and permanent microphone permission cases."""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import sys
import time

SPEC = importlib.util.spec_from_file_location('playtime_app_ui', Path(__file__).with_name('run-ui.py'))
assert SPEC and SPEC.loader
UI = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = UI
SPEC.loader.exec_module(UI)
Selector = UI.Selector


class AppCorners(UI.Suite):
    def restart(self) -> None:
        self.ui.run('shell', 'am', 'force-stop', self.ui.package)
        self.ui.run('shell', 'am', 'start', '-n', f'{self.ui.package}/.MainActivity')
        self.ui.wait(Selector(id='bottom-navigation'), 45)

    def lifecycle(self) -> None:
        self.resilience()
        self.api('/__test/events', {'action': 'failure', 'path': '/auth/tokenValid', 'status': 503})
        try:
            self.restart()
            self.ui.absent(Selector(id='auth-screen'))
            self.ui.wait(Selector(id='connection-banner'))
            self.ui.checkpoint('temporary-validation-outage-preserves-session')
        finally:
            self.api('/__test/events', {'action': 'clearFailures'})
        self.ui.tap(Selector(id='connection-banner'))
        self.ui.wait_absent(Selector(id='connection-banner'), 30)
        self.ui.wait(Selector(id='chat-Nova'))
        self.ui.checkpoint('outage-retry-restores-conversations')
        self.api('/__test/events', {'action': 'revoke', 'userId': 1})
        self.ui.wait(Selector(id='auth-screen'), 30)
        self.ui.checkpoint('remote-session-revocation-logs-out')
        self.login()
        self.restart()
        self.ui.wait(Selector(id='chat-Nova'))
        self.ui.checkpoint('fresh-session-restores-after-kill')

    def validation(self) -> None:
        self.restart()
        self.home('profile')
        self.ui.tap(Selector(description='Выйти из аккаунта'), True)
        self.ui.tap(Selector(text='Выйти'))
        self.ui.wait(Selector(id='auth-screen'))
        self.ui.tap(Selector(id='auth-register'), True)
        self.ui.fill(Selector(id='auth-email'), 'corners@example.test')
        self.ui.fill(Selector(id='auth-username'), 'ab', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(contains='Никнейм — от 3 до 15 символов без пробелов'))
        time.sleep(0.5)
        self.ui.checkpoint('registration-short-username', self.ui.assert_safe('auth-submit'))
        self.ui.fill(Selector(id='auth-username'), 'has space', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(contains='Никнейм — от 3 до 15 символов без пробелов'))
        time.sleep(0.5)
        self.ui.checkpoint('registration-spaces-username', self.ui.assert_safe('auth-submit'))
        self.ui.fill(Selector(id='auth-username'), 'CornerTester')
        self.ui.fill(Selector(id='auth-password'), 'short', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(contains='Пароль должен содержать от 12 до 50 символов'))
        time.sleep(0.5)
        self.ui.checkpoint('registration-short-password', self.ui.assert_safe('auth-submit'))
        self.ui.fill(Selector(id='auth-password'), 'PlayTime-test-123')
        self.ui.fill(Selector(id='auth-repeat'), 'PlayTime-test-123', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(contains='Примите соглашение'))
        time.sleep(0.5)
        self.ui.checkpoint('registration-requires-consent', self.ui.assert_safe('auth-submit'))
        self.ui.back()
        self.api('/__test/events', {'action': 'failure', 'path': '/auth/login', 'status': 503})
        try:
            self.ui.fill(Selector(id='auth-email'), 'mika@example.test')
            self.ui.fill(Selector(id='auth-password'), 'PlayTime-test-123', hide=True)
            self.ui.tap(Selector(id='auth-submit'), True)
            self.ui.wait(Selector(contains='сервер временно недоступен'))
            time.sleep(0.5)
            self.ui.checkpoint('login-server-error-visible', self.ui.assert_safe('auth-submit'))
        finally:
            self.api('/__test/events', {'action': 'clearFailures'})
        self.login()

    def verification(self) -> None:
        self.home('profile')
        self.ui.tap(Selector(description='Выйти из аккаунта'), True)
        self.ui.tap(Selector(text='Выйти'))
        self.ui.wait(Selector(id='auth-screen'))
        self.ui.tap(Selector(id='auth-register'), True)
        self.ui.fill(Selector(id='auth-username'), 'VerifyCorner')
        self.ui.fill(Selector(id='auth-email'), 'verifycorner@example.test')
        self.ui.fill(Selector(id='auth-password'), 'PlayTime-test-123')
        self.ui.fill(Selector(id='auth-repeat'), 'PlayTime-test-123', hide=True)
        self.ui.tap(Selector(id='auth-legal'), True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(id='auth-code'))
        self.ui.back()
        self.ui.fill(Selector(id='auth-email'), 'verifycorner@example.test')
        self.ui.fill(Selector(id='auth-password'), 'PlayTime-test-123', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(id='auth-code'))
        self.ui.checkpoint('unverified-login-opens-code-form')
        self.ui.fill(Selector(id='auth-code'), '123', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(contains='Введите код из 6 цифр'))
        self.ui.checkpoint('verification-code-length-validation')
        deadline = time.monotonic() + 65
        while self.ui.find(Selector(description='Отправить код ещё раз')) is None:
            assert time.monotonic() < deadline, 'Verification resend cooldown never ended'
            time.sleep(1)
        self.ui.tap(Selector(description='Отправить код ещё раз'), True)
        self.ui.wait(Selector(contains='Проверьте почту и папку Спам'))
        self.ui.wait(Selector(contains='Повторить через'))
        self.ui.checkpoint('verification-resend-restores-cooldown')
        self.ui.fill(Selector(id='auth-code'), '012345', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(description='Перейти ко входу'))
        self.ui.checkpoint('verification-after-resend-success')
        self.ui.tap(Selector(description='Перейти ко входу'))
        self.login()

    def namesearch(self) -> None:
        self.home('chats')
        if self.ui.find(Selector(id='conversation-search')) is None:
            self.ui.tap(Selector(id='conversation-search-toggle'))
        self.ui.fill(Selector(id='conversation-search'), 'nOvA', hide=True)
        self.ui.wait(Selector(id='chat-Nova'))
        self.ui.absent(Selector(id='chat-Orbit'))
        self.ui.checkpoint('conversation-name-search-case-insensitive')
        self.ui.tap(Selector(description='Очистить поиск'))
        self.ui.wait(Selector(id='chat-Orbit'))
        self.ui.absent(Selector(description='Очистить поиск'))
        self.ui.checkpoint('conversation-clear-search-restores-list')
        self.ui.tap(Selector(id='conversation-search-toggle'))
        self.ui.wait_absent(Selector(id='conversation-search'))

    def peer(self) -> None:
        self.home('friends')
        self.ui.tap(Selector(description='Профиль Orbit'), True)
        self.ui.wait(Selector(text='Orbit'))
        self.ui.wait_absent(Selector(text='Загрузка…'))
        self.ui.wait(Selector(description='Позвонить'))
        self.ui.checkpoint('peer-loaded-profile-and-accepted-actions')
        self.ui.tap(Selector(description='Удалить из друзей'), True)
        self.ui.tap(Selector(text='Удалить'))
        self.ui.wait(Selector(description='Добавить в друзья'))
        self.ui.absent(Selector(description='Написать'))
        self.ui.absent(Selector(description='Позвонить'))
        self.ui.tap(Selector(description='Добавить в друзья'))
        self.ui.wait(Selector(id='peer-pending-friendship'))
        self.ui.absent(Selector(description='Добавить в друзья'))
        self.ui.absent(Selector(description='Позвонить'))
        self.ui.checkpoint('peer-pending-request-does-not-offer-call-or-resend')
        self.ui.tap(Selector(description='Отменить заявку'))
        self.ui.wait_absent(Selector(id='peer-pending-friendship'))
        self.ui.wait(Selector(description='Добавить в друзья'))
        self.ui.checkpoint('peer-pending-request-cancelled')

    def encryption(self) -> None:
        self.restart()
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.fill(Selector(id='message-input'), '', hide=True)
        self.api('/__test/events', {'action': 'rotatePeerKey', 'username': 'Nova'})
        self.ui.back()
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.fill(Selector(id='message-input'), 'Send only after peer verification', hide=True)
        before = len(self.state()['messages'])
        self.ui.tap(Selector(id='message-send'))
        self.ui.wait(Selector(contains='Ключ собеседника изменился'))
        assert len(self.state()['messages']) == before
        self.ui.checkpoint('changed-peer-key-blocks-send-preserves-draft')
        self.ui.tap(Selector(description='Проверить ключ'))
        self.ui.wait(Selector(text='Новый ключ собеседника'))
        self.ui.checkpoint('changed-peer-key-explicit-confirmation')
        self.ui.tap(Selector(id='android:id/button2'))
        assert len(self.state()['messages']) == before
        self.ui.wait(Selector(description='Проверить ключ'))
        self.ui.tap(Selector(description='Проверить ключ'))
        self.ui.tap(Selector(id='android:id/button1'))
        self.ui.wait_absent(Selector(description='Проверить ключ'))
        self.ui.tap(Selector(id='message-send'))
        state = self.until(lambda data: len(data['messages']) > before)
        assert state['messages'][-1]['content'].startswith('E2E1:')
        self.ui.checkpoint('changed-peer-key-trusted-encrypted-send')
        self.api('/__test/events', {'action': 'incomingMessage', 'text': 'New peer identity received securely'})
        self.ui.wait(Selector(contains='New peer identity received securely'))
        self.ui.checkpoint('changed-peer-new-key-message-decrypted')

    def microphone(self) -> None:
        permission = 'android.permission.RECORD_AUDIO'
        self.ui.run('shell', 'pm', 'revoke', self.ui.package, permission)
        self.ui.run('shell', 'pm', 'clear-permission-flags', self.ui.package, permission, 'user-set', 'user-fixed')
        self.restart()
        self.ui.tap(Selector(id='chat-Nova'))
        for attempt in range(2):
            self.ui.tap(Selector(id='voice-record'))
            self.ui.wait(Selector(id='com.android.permissioncontroller:id/permission_deny_button'))
            self.ui.tap(Selector(id='com.android.permissioncontroller:id/permission_deny_button'))
            if attempt == 0:
                self.ui.absent(Selector(id='voice-send'))
        self.ui.wait(Selector(text='Микрофон отключён'))
        self.ui.checkpoint('microphone-permanent-denial-explained')
        self.ui.tap(Selector(text='Не сейчас'))
        self.ui.absent(Selector(id='voice-send'))
        self.ui.fill(Selector(id='message-input'), 'Text remains available without microphone', hide=True)
        self.ui.checkpoint('microphone-denial-keeps-text-available')
        self.ui.fill(Selector(id='message-input'), '', hide=True)
        self.ui.tap(Selector(id='voice-record'))
        self.ui.tap(Selector(text='Настройки'))
        self.ui.tap(Selector(text='Permissions'), True)
        self.ui.tap(Selector(text='Microphone'), True)
        self.ui.tap(Selector(text='Allow only while using the app'), True)
        self.ui.checkpoint('microphone-enabled-in-system-settings')
        for _ in range(4):
            if self.ui.find(Selector(id='chat-screen')) is not None:
                break
            self.ui.back()
        self.ui.wait(Selector(id='voice-record'))
        self.ui.tap(Selector(id='voice-record'))
        self.ui.wait(Selector(id='voice-stop'))
        self.ui.checkpoint('microphone-settings-return-records')
        self.ui.tap(Selector(description='Отменить запись'))
        self.ui.wait_absent(Selector(id='voice-stop'))
        self.ui.absent(Selector(id='voice-preview'))
        self.ui.checkpoint('voice-recording-cancel-cleans-up')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--adb', default=UI.DEFAULT_ADB)
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--fixture', default='http://127.0.0.1:1502')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--groups', default='lifecycle,validation,microphone')
    args = parser.parse_args()
    ui = UI.AndroidUI(args.adb, args.serial, args.output, 'com.playtimemobile')
    suite = AppCorners(ui, args.fixture)
    try:
        for group in args.groups.split(','):
            suite.run_group(group)
    except Exception as error:
        print(f'FAILED: {error}', file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
