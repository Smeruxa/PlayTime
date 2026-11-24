#!/usr/bin/env python3
"""Device-driven responsive-layout and keyboard acceptance on an isolated emulator."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys
import struct
import time

spec = importlib.util.spec_from_file_location('playtime_ui', Path(__file__).with_name('run-ui.py'))
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
sys.modules['playtime_ui'] = module
spec.loader.exec_module(module)
Selector = module.Selector
AndroidUI = module.AndroidUI
Suite = module.Suite


def focused_above_keyboard(ui: AndroidUI, test_id: str) -> dict[str, object]:
    assert ui.keyboard_visible(), 'Software keyboard did not open'
    node = ui.wait(Selector(id=test_id))
    bounds = ui.bounds(node)
    insets = ui.insets()
    top = max(insets.get('statusBars', (0, 0, 0, 0))[3], insets.get('displayCutout', (0, 0, 0, 0))[3])
    assert 'ime' in insets, 'IME frame is missing'
    assert bounds[1] >= top, f'{test_id} is clipped by the status bar: {bounds}'
    assert bounds[3] <= insets['ime'][1], f'{test_id} overlaps keyboard: {bounds} / {insets["ime"]}'
    assert bounds[2] <= ui.width and bounds[0] >= 0, f'{test_id} overflows horizontally'
    return {'focusedField': bounds, 'systemInsets': insets}


def run_auth(ui: AndroidUI, suite: Suite) -> None:
    ui.wait(Selector(id='auth-screen'))
    ui.checkpoint('small-login')
    ui.fill(Selector(id='auth-email'), 'mika@example.test')
    ui.checkpoint('small-login-email-keyboard', focused_above_keyboard(ui, 'auth-email'))
    ui.fill(Selector(id='auth-password'), 'PlayTime-test-123')
    ui.checkpoint('small-login-password-keyboard', focused_above_keyboard(ui, 'auth-password'))
    ui.hide_keyboard()
    ui.tap(Selector(id='auth-submit'), True)
    ui.wait(Selector(id='bottom-navigation'), 30)
    ui.checkpoint('small-conversations', ui.assert_safe('bottom-navigation'))


def run_chat(ui: AndroidUI, suite: Suite, font_scales: list[float]) -> None:
    for mode in ['gestural', 'threebutton']:
        ui.hide_keyboard()
        ui.run('shell', 'cmd', 'overlay', 'enable-exclusive', '--category', f'com.android.internal.systemui.navbar.{mode}')
        for scale in font_scales:
            ui.run('shell', 'settings', 'put', 'system', 'font_scale', str(scale))
            time.sleep(1)
            suite.home('chats')
            ui.checkpoint(f'small-{mode}-font-{scale}-home', ui.assert_safe('bottom-navigation'))
            ui.tap(Selector(id='chat-Nova'), True)
            ui.fill(Selector(id='message-input'), 'Small display and large font keyboard regression')
            details = ui.assert_keyboard()
            details.update(focused_above_keyboard(ui, 'message-input'))
            details['fontScale'] = scale
            ui.checkpoint(f'small-{mode}-font-{scale}-keyboard', details)
            ui.hide_keyboard()
            ui.checkpoint(f'small-{mode}-font-{scale}-chat', ui.assert_safe('back', 'chat-composer'))


def run_forms(ui: AndroidUI, suite: Suite, font_scales: list[float]) -> None:
    for scale in font_scales:
        ui.run('shell', 'settings', 'put', 'system', 'font_scale', str(scale))
        time.sleep(1)
        suite.home('profile')
        ui.checkpoint(f'small-font-{scale}-profile-home', ui.assert_safe('bottom-navigation'))
        ui.tap(Selector(id='edit-profile'), True)
        ui.fill(Selector(id='profile-bio'), 'A longer biography for the small screen keyboard acceptance')
        ui.checkpoint(f'small-font-{scale}-profile-bio-keyboard', focused_above_keyboard(ui, 'profile-bio'))
        ui.hide_keyboard()
        ui.back()
        ui.wait(Selector(contains='несохран'))
        ui.checkpoint(f'small-font-{scale}-discard-confirmation')
        ui.tap(Selector(text='Выйти'))
        ui.tap(Selector(contains='Аккаунт и безопасность'), True)
        ui.tap(Selector(contains='Сменить пароль'), True)
        for field in ['password-current', 'password-new', 'password-repeat']:
            ui.fill(Selector(id=field), 'Example-password-123')
            ui.checkpoint(f'small-font-{scale}-{field}-keyboard', focused_above_keyboard(ui, field))
        ui.hide_keyboard()
        ui.back()
        suite.home('rooms')
        ui.tap(Selector(id='new-conversation'))
        ui.fill(Selector(id='room-name'), 'Small room')
        ui.checkpoint(f'small-font-{scale}-room-keyboard', focused_above_keyboard(ui, 'room-name'))
        ui.hide_keyboard()
        ui.back()
        suite.home('friends')
        ui.fill(Selector(id='friend-username'), 'Someone')
        ui.checkpoint(f'small-font-{scale}-friend-keyboard', focused_above_keyboard(ui, 'friend-username'))
        ui.hide_keyboard()


def run_landscape(ui: AndroidUI, suite: Suite, font_scales: list[float]) -> None:
    ui.run('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '1')
    try:
        for scale in font_scales:
            ui.run('shell', 'settings', 'put', 'system', 'font_scale', str(scale))
            time.sleep(1)
            frame = ui.run('exec-out', 'screencap', '-p', binary=True)
            ui.width, ui.height = struct.unpack('>II', frame[16:24])
            assert ui.width > ui.height, 'Device did not rotate to landscape'
            suite.home('chats')
            ui.checkpoint(f'landscape-font-{scale}-home')
            ui.tap(Selector(id='chat-Nova'), True)
            ui.fill(Selector(id='message-input'), 'Landscape input remains above the keyboard while writing a longer message')
            ui.checkpoint(f'landscape-font-{scale}-keyboard', ui.assert_keyboard())
            ui.wait(Selector(id='back'))
            ui.hide_keyboard()
            ui.checkpoint(f'landscape-font-{scale}-chat')
    finally:
        ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '0')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', default='emulator-5558')
    parser.add_argument('--adb', default=module.DEFAULT_ADB)
    parser.add_argument('--fixture', default='http://127.0.0.1:1506')
    parser.add_argument('--output', default='mobile/e2e/artifacts/small-layout')
    parser.add_argument('--fresh', action='store_true')
    parser.add_argument('--phase', choices=['auth', 'chat', 'forms', 'landscape'], required=True)
    parser.add_argument('--font-scales', default='1,1.3,1.6,2')
    args = parser.parse_args()
    ui = AndroidUI(args.adb, args.serial, Path(args.output), 'com.playtimemobile')
    suite = Suite(ui, args.fixture)
    result: dict[str, object] = {'device': args.serial, 'phase': args.phase, 'size': [ui.width, ui.height]}
    try:
        if args.fresh:
            suite.reset()
        else:
            ui.run('shell', 'am', 'start', '-n', f'{ui.package}/.MainActivity')
            deadline = time.monotonic() + 40
            while time.monotonic() < deadline:
                tree = ui.tree()
                if any(ui.find(Selector(id=anchor), tree) is not None for anchor in ['bottom-navigation', 'settings-screen', 'message-input']):
                    break
                time.sleep(0.5)
            else:
                raise AssertionError('Application did not restore its authenticated UI')
        if args.phase == 'auth':
            run_auth(ui, suite)
        elif args.phase == 'chat':
            run_chat(ui, suite, [float(value) for value in args.font_scales.split(',')])
        elif args.phase == 'forms':
            run_forms(ui, suite, [float(value) for value in args.font_scales.split(',')])
        else:
            run_landscape(ui, suite, [float(value) for value in args.font_scales.split(',')])
        result['status'] = 'passed'
    except Exception as error:
        result['status'] = 'failed'
        result['error'] = str(error)
        ui.checkpoint('layout-failure')
        raise
    finally:
        result['checkpoints'] = ui.checkpoints
        (ui.output / 'report.json').write_text(json.dumps(result, ensure_ascii=False, indent=4), encoding='utf8')


if __name__ == '__main__':
    main()
