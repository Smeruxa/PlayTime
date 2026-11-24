#!/usr/bin/env python3
"""Real registration/verification background and cold-process restoration on localhost only."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys
import time

SPEC = importlib.util.spec_from_file_location('auth_resume_ui', Path(__file__).with_name('run-ui.py'))
assert SPEC and SPEC.loader
UI = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = UI
SPEC.loader.exec_module(UI)
Selector = UI.Selector


class AuthResumeSuite(UI.Suite):
    def cold_start(self) -> None:
        self.ui.run('shell', 'am', 'force-stop', self.ui.package)
        self.ui.run('shell', 'am', 'start', '-n', self.ui.package + '/.MainActivity')
        self.ui.wait(Selector(id='auth-screen'), 35)

    def login_screen(self) -> None:
        if self.ui.find(Selector(id='auth-screen')) is None:
            self.home('profile')
            self.ui.tap(Selector(description='Выйти из аккаунта'), True)
            self.ui.tap(Selector(text='Выйти'))
            self.ui.wait(Selector(id='auth-screen'))
        tree = self.ui.tree()
        if any(n.get('content-desc') == 'Вернуться ко входу' for n in tree.iter('node')):
            self.ui.hide_keyboard()
            self.ui.back()
        self.ui.locate(Selector(id='auth-forgot'), True)

    def identity(self, suffix: str) -> tuple[str, str]:
        value = str(int(time.time()))[-6:] + suffix
        return 'Resume' + value, 'resume' + value + '@example.test'

    def register(self, suffix: str) -> tuple[str, str]:
        self.login_screen()
        name, email = self.identity(suffix)
        self.ui.tap(Selector(id='auth-register'), True)
        self.ui.fill(Selector(id='auth-username'), name)
        self.ui.fill(Selector(id='auth-email'), email)
        self.ui.fill(Selector(id='auth-password'), 'PlayTime-test-123')
        self.ui.fill(Selector(id='auth-repeat'), 'PlayTime-test-123', hide=True)
        self.ui.tap(Selector(id='auth-legal'), True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(id='auth-code'))
        return name, email

    def email_is(self, email: str) -> None:
        field = self.ui.locate(Selector(id='auth-email'), True)
        assert field.get('text') == email, f'Auth identity changed: {field.get("text")}'

    def cooldown(self) -> int:
        node = self.ui.locate(Selector(contains='Повторить через'), True)
        assert node.get('enabled') == 'false', 'Resend is enabled before the deadline'
        text = node.get('text', '') + node.get('content-desc', '')
        match = re.search(r'Повторить через (\d+) с', text)
        assert match, text
        return int(match.group(1))

    def switch_app(self, settings: bool = False) -> None:
        if settings:
            self.ui.run('shell', 'am', 'start', '-a', 'android.settings.SETTINGS')
        else:
            self.ui.run('shell', 'input', 'keyevent', '3')
        time.sleep(0.8)
        self.ui.run('shell', 'am', 'start', '-n', self.ui.package + '/.MainActivity')
        self.ui.wait(Selector(id='auth-screen'), 30)
        time.sleep(0.4)

    def draft(self) -> None:
        self.login_screen()
        name, email = self.identity('D')
        self.ui.tap(Selector(id='auth-register'), True)
        self.ui.fill(Selector(id='auth-username'), name)
        self.ui.fill(Selector(id='auth-email'), email)
        self.ui.fill(Selector(id='auth-password'), 'Unsaved-only-123', hide=True)
        self.ui.checkpoint('registration-draft-before-background')
        self.switch_app(settings=True)
        self.email_is(email)
        assert self.ui.locate(Selector(id='auth-password'), True).get('text'), 'Live background lost the password draft'
        self.ui.checkpoint('registration-draft-after-another-app')
        self.cold_start()
        self.email_is(email)
        assert self.ui.locate(Selector(id='auth-username'), True).get('text') == name
        assert not self.ui.locate(Selector(id='auth-password'), True).get('text'), 'Password was persisted'
        assert self.ui.locate(Selector(id='auth-legal'), True).get('checked') != 'true', 'Consent was persisted'
        self.ui.checkpoint('cold-registration-restores-safe-fields-only')
        self.ui.hide_keyboard()
        self.ui.back()

    def verification(self) -> None:
        _, email = self.register('V')
        before = self.cooldown()
        self.ui.checkpoint('verification-awaiting-email', {'resendSeconds': before})
        process_id = self.ui.run('shell', 'pidof', self.ui.package).strip()
        self.switch_app()
        self.ui.locate(Selector(id='auth-code'), True)
        self.email_is(email)
        assert self.ui.run('shell', 'pidof', self.ui.package).strip() == process_id
        after_home = self.cooldown()
        assert after_home <= before, 'Foreground restarted resend cooldown'
        self.ui.checkpoint('verification-survives-home-return', {'samePid': process_id, 'resendSeconds': after_home})
        self.switch_app(settings=True)
        self.ui.locate(Selector(id='auth-code'), True)
        self.email_is(email)
        self.ui.checkpoint('verification-survives-another-app-return')
        self.ui.fill(Selector(id='auth-code'), '123', hide=True)
        before_kill = self.cooldown()
        self.cold_start()
        self.email_is(email)
        assert self.ui.locate(Selector(id='auth-code'), True).get('text') in ('', '6 цифр'), 'Verification code was persisted'
        after_kill = self.cooldown()
        assert 0 < after_kill <= before_kill, 'Cold process bypassed or restarted resend cooldown'
        assert self.ui.run('shell', 'pidof', self.ui.package).strip() != process_id
        self.ui.checkpoint('cold-verification-keeps-email-deadline-without-code', {'beforeKill': before_kill, 'afterKill': after_kill})
        self.ui.fill(Selector(id='auth-code'), '012345', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(description='Перейти ко входу'))
        self.ui.checkpoint('restored-verification-code-submitted')
        self.ui.tap(Selector(description='Перейти ко входу'))
        self.cold_start()
        self.ui.locate(Selector(id='auth-forgot'), True)
        self.ui.absent(Selector(id='auth-code'))
        self.ui.checkpoint('verified-flow-cleared-on-cold-login')

    def isolation(self) -> None:
        self.register('I')
        self.ui.hide_keyboard()
        self.ui.back()
        self.ui.locate(Selector(id='auth-forgot'), True)
        self.login('mika@example.test', 'PlayTime-test-123')
        self.home('profile')
        self.ui.tap(Selector(description='Выйти из аккаунта'), True)
        self.ui.tap(Selector(text='Выйти'))
        self.ui.wait(Selector(id='auth-screen'))
        self.cold_start()
        self.ui.locate(Selector(id='auth-forgot'), True)
        self.ui.absent(Selector(id='auth-code'))
        self.ui.absent(Selector(id='auth-username'))
        self.ui.checkpoint('another-account-logout-cannot-restore-old-verification')
        self.login()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--fixture', default='http://127.0.0.1:1502')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--groups', default='draft,verification,isolation')
    args = parser.parse_args()
    ui = UI.AndroidUI(UI.DEFAULT_ADB, args.serial, args.output, 'com.playtimemobile')
    suite = AuthResumeSuite(ui, args.fixture)
    try:
        ui.run('shell', 'am', 'force-stop', ui.package)
        ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            if ui.find(Selector(id='auth-screen')) is not None or ui.find(Selector(id='bottom-navigation')) is not None:
                break
            time.sleep(0.2)
        for group in args.groups.split(','):
            suite.run_group(group)
    except Exception as error:
        print(f'FAILED: {error}', file=sys.stderr, flush=True)
        return 1
    print(f'Auth background/cold-process restoration passed: {args.output}', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
