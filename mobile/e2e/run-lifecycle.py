#!/usr/bin/env python3
"""Exercise notification consent/routing and recording interruption through Android UI."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys
import time

spec = importlib.util.spec_from_file_location('playtime_ui', Path(__file__).with_name('run-ui.py'))
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
sys.modules['playtime_ui'] = module
spec.loader.exec_module(module)
Selector = module.Selector
AndroidUI = module.AndroidUI
Suite = module.Suite


def foreground(ui: AndroidUI) -> None:
    ui.run('shell', 'am', 'start', '-n', f'{ui.package}/.MainActivity')
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        tree = ui.tree()
        if any(ui.find(Selector(id=anchor), tree) is not None for anchor in ['bottom-navigation', 'settings-screen', 'message-input']):
            return
        time.sleep(0.5)
    raise AssertionError('Application did not finish restoring the authenticated UI')


def settings(ui: AndroidUI, suite: Suite) -> None:
    suite.home('profile')
    ui.tap(Selector(description='Настройки'))
    ui.wait(Selector(id='settings-screen'))


def background(ui: AndroidUI) -> None:
    ui.run('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    time.sleep(1)


def app_notifications(ui: AndroidUI) -> list[str]:
    entries = ui.run('shell', 'cmd', 'notification', 'list')
    return [entry for entry in entries.splitlines() if f'|{ui.package}|' in entry]


def wait_notifications(ui: AndroidUI, expected: bool) -> list[str]:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        entries = app_notifications(ui)
        if bool(entries) == expected:
            if not expected:
                time.sleep(1)
                assert not app_notifications(ui), 'Unexpected delayed notification'
            return entries
        time.sleep(0.3)
    raise AssertionError(f'Expected notification present={expected}')


def incoming(suite: Suite, text: str) -> None:
    suite.api('/__test/events', {'action': 'incomingMessage', 'from': 'Nova', 'text': text})


def open_notification(ui: AndroidUI, checkpoint: str) -> None:
    ui.run('shell', 'cmd', 'statusbar', 'expand-notifications')
    ui.wait(Selector(text='Новое сообщение'))
    ui.absent(Selector(contains='Private notification'))
    ui.checkpoint(checkpoint)
    ui.tap(Selector(text='Новое сообщение'))
    ui.wait(Selector(id='message-input'), 30)
    ui.checkpoint(f'{checkpoint}-opened-chat', ui.assert_safe('back', 'chat-composer'))
    wait_notifications(ui, False)


def notifications(ui: AndroidUI, suite: Suite) -> None:
    permission = 'android.permission.POST_NOTIFICATIONS'
    ui.run('shell', 'pm', 'revoke', ui.package, permission)
    ui.run('shell', 'pm', 'clear-permission-flags', ui.package, permission, 'user-set', 'user-fixed')
    foreground(ui)
    settings(ui, suite)
    toggle = ui.locate(Selector(id='notifications-toggle'), True)
    if toggle.attrib.get('checked') == 'true':
        ui.tap(Selector(id='notifications-toggle'))
    ui.tap(Selector(id='notifications-toggle'))
    ui.wait(Selector(id='com.android.permissioncontroller:id/permission_deny_button'))
    ui.checkpoint('notification-consent-at-use')
    ui.tap(Selector(id='com.android.permissioncontroller:id/permission_deny_button'))
    ui.wait(Selector(contains='Уведомления не разрешены'))
    assert ui.wait(Selector(id='notifications-toggle')).attrib.get('checked') == 'false'
    ui.checkpoint('notification-denied-app-usable')
    ui.tap(Selector(id='notifications-toggle'))
    ui.wait(Selector(id='com.android.permissioncontroller:id/permission_allow_button'))
    ui.tap(Selector(id='com.android.permissioncontroller:id/permission_allow_button'))
    assert ui.wait(Selector(id='notifications-toggle')).attrib.get('checked') == 'true'
    ui.checkpoint('notification-granted')
    suite.home('chats')
    background(ui)
    incoming(suite, 'Private notification background')
    wait_notifications(ui, True)
    open_notification(ui, 'notification-background-private-preview')
    ui.wait(Selector(contains='Private notification background'))
    incoming(suite, 'Private notification visible conversation')
    ui.wait(Selector(contains='Private notification visible conversation'))
    wait_notifications(ui, False)
    ui.checkpoint('visible-chat-does-not-notify')
    ui.tap(Selector(id='chat-menu'))
    ui.tap(Selector(description='Отключить уведомления чата'), True)
    ui.wait(Selector(description='Включить уведомления чата'))
    ui.back()
    background(ui)
    incoming(suite, 'Private notification muted conversation')
    time.sleep(2)
    wait_notifications(ui, False)
    foreground(ui)
    ui.tap(Selector(id='chat-menu'))
    ui.tap(Selector(description='Включить уведомления чата'), True)
    ui.wait(Selector(description='Отключить уведомления чата'))
    ui.back()
    background(ui)
    incoming(suite, 'Private notification cold-start target')
    wait_notifications(ui, True)
    ui.run('shell', 'am', 'kill', ui.package)
    time.sleep(1)
    processes = ui.run('shell', 'ps', '-A', '-o', 'NAME,PID')
    assert not any(row.startswith(ui.package + ' ') for row in processes.splitlines()), 'Background app was not killed'
    open_notification(ui, 'notification-cold-start')
    ui.wait(Selector(contains='Private notification cold-start target'), 30)
    ui.checkpoint('notification-cold-start-restored-session')


def microphone(ui: AndroidUI, suite: Suite) -> None:
    settings(ui, suite)
    ui.tap(Selector(id='microphone-test'), True)
    allow = ui.find(Selector(id='com.android.permissioncontroller:id/permission_allow_foreground_only_button'))
    if allow is not None:
        ui.checkpoint('microphone-consent-at-use')
        ui.tap(Selector(id='com.android.permissioncontroller:id/permission_allow_foreground_only_button'))
    ui.wait(Selector(contains='Идёт запись'))
    ui.checkpoint('microphone-test-recording')
    background(ui)
    time.sleep(1)
    foreground(ui)
    ui.wait(Selector(contains='Запись прервана'))
    ui.wait(Selector(text='Проверить микрофон'))
    ui.absent(Selector(contains='Идёт запись'))
    ui.checkpoint('microphone-interrupted-on-background')
    ui.tap(Selector(id='microphone-test'))
    ui.wait(Selector(contains='Идёт запись'))
    time.sleep(11)
    ui.wait(Selector(text='Прослушать запись'))
    ui.absent(Selector(contains='Идёт запись'))
    ui.checkpoint('microphone-duration-limit-preview')
    ui.tap(Selector(id='microphone-test'))
    ui.wait(Selector(text='Проверить микрофон'))
    ui.checkpoint('microphone-preview-playback')
    ui.back()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', default='emulator-5558')
    parser.add_argument('--fixture', default='http://127.0.0.1:1506')
    parser.add_argument('--output', type=Path, default=Path('mobile/e2e/artifacts/lifecycle'))
    parser.add_argument('--groups', default='notifications,microphone')
    args = parser.parse_args()
    ui = AndroidUI(module.DEFAULT_ADB, args.serial, args.output, 'com.playtimemobile')
    suite = Suite(ui, args.fixture)
    ui.run('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
    result: dict[str, object] = {'device': args.serial, 'groups': []}
    try:
        for group in args.groups.split(','):
            print(f'RUN {group}', flush=True)
            {'notifications': notifications, 'microphone': microphone}[group](ui, suite)
            result['groups'].append({'group': group, 'status': 'passed'})
            print(f'PASS {group}', flush=True)
        result['status'] = 'passed'
    except Exception as error:
        result['status'] = 'failed'
        result['error'] = str(error)
        ui.checkpoint('lifecycle-failure')
        raise
    finally:
        result['checkpoints'] = ui.checkpoints
        (ui.output / 'report.json').write_text(json.dumps(result, ensure_ascii=False, indent=4), encoding='utf8')


if __name__ == '__main__':
    main()
