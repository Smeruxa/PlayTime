#!/usr/bin/env python3
"""Click the installed Android app through adb/UIAutomator and retain visual evidence.

No app-state or JavaScript injection is used. HTTP access is restricted to the local
fixture's reset/control/assertion endpoints; every product action is performed in UI.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Callable

DEFAULT_ADB = '/tmp/playtime-android-tools/sdk/platform-tools/adb'
ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Selector:
    id: str | None = None
    text: str | None = None
    description: str | None = None
    contains: str | None = None

    def matches(self, node: ET.Element) -> bool:
        attrs = node.attrib
        resource = attrs.get('resource-id', '')
        if self.id and resource != self.id and not resource.endswith('/' + self.id):
            return False
        if self.text is not None and attrs.get('text', '').casefold() != self.text.casefold():
            return False
        if self.description is not None and attrs.get('content-desc', '') != self.description:
            return False
        if self.contains is not None and self.contains not in attrs.get('text', '') and self.contains not in attrs.get('content-desc', ''):
            return False
        return True


class AndroidUI:
    def __init__(self, adb: str, serial: str, output: Path, package: str):
        self.adb = adb
        self.serial = serial
        self.output = output.resolve()
        self.package = package
        self.output.mkdir(parents=True, exist_ok=True)
        self.sequence = 0
        try:
            self.has_hierarchy_driver = bool(self.run('shell', 'pm', 'path', 'com.playtime.uidriver').strip())
        except RuntimeError:
            self.has_hierarchy_driver = False
        self.checkpoints: list[dict[str, object]] = []
        size = self.run('shell', 'wm', 'size')
        matches = re.findall(r'(\d+)x(\d+)', size)
        self.width, self.height = map(int, matches[-1])

    def run(self, *args: str, binary: bool = False, timeout: int = 30) -> str | bytes:
        result = subprocess.run([self.adb, '-s', self.serial, *args], capture_output=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError(f'adb {args}: {result.stderr.decode(errors="replace")}')
        return result.stdout if binary else result.stdout.decode(errors='replace')

    def tree(self) -> ET.Element:
        for _attempt in range(3):
            if self.has_hierarchy_driver:
                xml = self.run('shell', 'am', 'instrument', '-w', '-r', 'com.playtime.uidriver/.HierarchyInstrumentation', timeout=20)
            else:
                xml = self.run('exec-out', 'uiautomator', 'dump', '/dev/tty', timeout=20)
            start = xml.find('<hierarchy')
            end = xml.rfind('</hierarchy>')
            if start >= 0 and end >= 0:
                return ET.fromstring(xml[start:end + len('</hierarchy>')])
            time.sleep(0.3)
        raise RuntimeError(f'UIAutomator did not return a hierarchy: {xml[:300]}')

    @staticmethod
    def bounds(node: ET.Element) -> tuple[int, int, int, int]:
        values = re.findall(r'-?\d+', node.attrib.get('bounds', ''))
        if len(values) != 4:
            raise AssertionError(f'No usable bounds for {node.attrib}')
        left, top, right, bottom = map(int, values)
        return left, top, right, bottom

    def find(self, selector: Selector, tree: ET.Element | None = None) -> ET.Element | None:
        root = tree if tree is not None else self.tree()
        for node in root.iter('node'):
            if selector.matches(node):
                x1, y1, x2, y2 = self.bounds(node)
                if x2 > x1 and y2 > y1 and y2 > 0 and y1 < self.height:
                    return node
        return None

    def wait(self, selector: Selector, timeout: float = 20) -> ET.Element:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            node = self.find(selector)
            if node is not None:
                return node
            time.sleep(0.25)
        self.checkpoint('missing-element')
        raise AssertionError(f'Element did not appear: {selector}')

    def wait_absent(self, selector: Selector, timeout: float = 20) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.find(selector) is None:
                return
            time.sleep(0.25)
        raise AssertionError(f'Element remained visible: {selector}')

    def absent(self, selector: Selector) -> None:
        assert self.find(selector) is None, f'Unexpected visible element: {selector}'

    def scroll(self, direction: str = 'down') -> None:
        top, bottom = int(self.height * 0.24), int(self.height * 0.76)
        start, end = (bottom, top) if direction == 'down' else (top, bottom)
        self.run('shell', 'input', 'swipe', str(self.width // 2), str(start), str(self.width // 2), str(end), '350')
        time.sleep(0.25)

    def locate(self, selector: Selector, scroll: bool = False) -> ET.Element:
        node = self.find(selector)
        if node is not None:
            return node
        if scroll:
            for _ in range(6):
                self.scroll('down')
                node = self.find(selector)
                if node is not None:
                    return node
            for _ in range(7):
                self.scroll('up')
                node = self.find(selector)
                if node is not None:
                    return node
        return self.wait(selector, timeout=5)

    def tap(self, selector: Selector, scroll: bool = False) -> None:
        node = self.locate(selector, scroll)
        assert node.attrib.get('enabled') != 'false', f'Disabled element: {selector}'
        x1, y1, x2, y2 = self.bounds(node)
        self.run('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
        time.sleep(0.25)

    def hold(self, selector: Selector, milliseconds: int = 850) -> None:
        node = self.locate(selector, True)
        x1, y1, x2, y2 = self.bounds(node)
        x, y = str((x1 + x2) // 2), str((y1 + y2) // 2)
        self.run('shell', 'input', 'swipe', x, y, x, y, str(milliseconds))
        time.sleep(0.3)

    def fill(self, selector: Selector, value: str, hide: bool = False) -> None:
        if not value.isascii():
            raise ValueError('Use ASCII fixtures with adb input text; UI assertions may use Unicode')
        self.hide_keyboard()
        node = self.locate(selector, True)
        x1, y1, x2, y2 = self.bounds(node)
        self.run('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
        time.sleep(0.5)
        for attempt in range(3):
            self.run('shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A')
            time.sleep(0.25)
            self.run('shell', 'input', 'keyevent', 'KEYCODE_DEL')
            time.sleep(0.4)
            if value:
                self.run('shell', 'input', 'text', shlex.quote(value.replace(' ', '%s')))
            time.sleep(0.4)
            current = self.find(selector)
            if current is None:
                raise AssertionError(f'Focused input disappeared: {selector}')
            actual = current.attrib.get('text', '')
            secret = current.attrib.get('password') == 'true'
            matches = len(actual) == len(value) if secret else actual.casefold() == value.casefold()
            if not value or matches:
                break
            if attempt == 2:
                raise AssertionError(f'Native text entry did not match expected value for {selector}')
        if hide:
            self.hide_keyboard()

    def back(self) -> None:
        self.run('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        time.sleep(0.3)

    def keyboard_visible(self) -> bool:
        info = self.run('shell', 'dumpsys', 'input_method')
        current = re.search(r'^\s*mInputShown=(true|false)\s*$', info, re.MULTILINE)
        return current is not None and current.group(1) == 'true' and 'ime' in self.insets()

    def hide_keyboard(self) -> None:
        time.sleep(0.4)
        if self.keyboard_visible():
            self.back()

    def insets(self) -> dict[str, tuple[int, int, int, int]]:
        windows = self.run('shell', 'dumpsys', 'window')
        result = {}
        for match in re.finditer(r'type=(statusBars|navigationBars|displayCutout|ime)\s+frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\].*?visible=(true|false)', windows):
            kind, x1, y1, x2, y2, visible = match.groups()
            if visible == 'true':
                result[kind] = (int(x1), int(y1), int(x2), int(y2))
        return result

    def assert_safe(self, *ids: str) -> dict[str, object]:
        root = self.tree()
        insets = self.insets()
        assert 'statusBars' in insets and 'navigationBars' in insets, 'System bar insets unavailable'
        checks = {}
        for test_id in ids:
            node = self.find(Selector(id=test_id), root)
            assert node is not None, f'Missing layout anchor: {test_id}'
            bounds = self.bounds(node)
            for kind in ('statusBars', 'navigationBars', 'displayCutout'):
                bar = insets.get(kind)
                if bar is None:
                    continue
                overlap_width = min(bounds[2], bar[2]) - max(bounds[0], bar[0])
                overlap_height = min(bounds[3], bar[3]) - max(bounds[1], bar[1])
                assert overlap_width <= 0 or overlap_height <= 0, f'{test_id} overlaps {kind}: {bounds} / {bar}'
            assert bounds[0] >= 0 and bounds[2] <= self.width, f'{test_id} overflows horizontally'
            checks[test_id] = bounds
        return {'systemInsets': insets, 'bounds': checks}

    def assert_keyboard(self, action_id: str = 'message-send') -> dict[str, object]:
        assert self.keyboard_visible(), 'Software keyboard did not open'
        composer = self.wait(Selector(id='chat-composer'))
        send = self.wait(Selector(id=action_id))
        insets = self.insets()
        assert 'ime' in insets, 'IME insets unavailable'
        keyboard_top = insets['ime'][1]
        assert self.bounds(composer)[3] <= keyboard_top, f'Composer overlaps IME: {self.bounds(composer)} / {keyboard_top}'
        assert self.bounds(send)[3] <= keyboard_top, 'Send action is under keyboard'
        density = re.findall(r'(?:Physical|Override) density: (\d+)', self.run('shell', 'wm', 'density'))
        assert density, 'Android display density unavailable'
        minimum_target = round(48 * int(density[-1]) / 160) - 1
        send_bounds = self.bounds(send)
        assert send_bounds[2] - send_bounds[0] >= minimum_target, 'Send target is clipped horizontally'
        assert send_bounds[3] - send_bounds[1] >= minimum_target, 'Send target is clipped vertically'
        return {'composer': self.bounds(composer), 'send': self.bounds(send), 'ime': insets.get('ime')}

    def checkpoint(self, name: str, details: dict[str, object] | None = None) -> None:
        time.sleep(0.25)
        self.sequence += 1
        stem = f'{self.sequence:03d}-{re.sub(r"[^a-z0-9_-]", "-", name.lower())}'
        png = self.output / f'{stem}.png'
        png.write_bytes(self.run('exec-out', 'screencap', '-p', binary=True))
        try:
            root = self.tree()
            (self.output / f'{stem}.xml').write_text(ET.tostring(root, encoding='unicode'), encoding='utf8')
        except Exception as error:
            details = {**(details or {}), 'hierarchyError': str(error)}
        self.checkpoints.append({'name': name, 'screenshot': str(png), 'details': details or {}})
        print(f'  screenshot {stem}', flush=True)


class Suite:
    def __init__(self, ui: AndroidUI, fixture: str):
        self.ui = ui
        self.fixture = fixture.rstrip('/')
        self.results: list[dict[str, object]] = []

    def api(self, path: str, body: dict[str, object] | None = None) -> dict:
        request = urllib.request.Request(self.fixture + path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method='GET' if body is None else 'POST')
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    def state(self) -> dict:
        return self.api('/__test/state')

    def until(self, predicate: Callable[[dict], bool], timeout: float = 15) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            state = self.state()
            if predicate(state):
                return state
            time.sleep(0.2)
        raise AssertionError('Fixture assertion timed out')

    def reset(self) -> None:
        self.ui.run('shell', 'am', 'force-stop', self.ui.package)
        self.ui.run('shell', 'pm', 'clear', self.ui.package)
        self.api('/__test/reset', {})
        self.ui.run('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1')
        self.ui.run('shell', 'am', 'start', '-n', f'{self.ui.package}/.MainActivity')
        self.ui.wait(Selector(id='auth-screen'), 45)
        self.ui.run('shell', 'input', 'keyevent', '82')
        refresh = self.ui.wait(Selector(contains='Fast Refresh'))
        if 'Disable' in refresh.attrib.get('text', ''):
            self.ui.tap(Selector(text=refresh.attrib['text']))
        else:
            self.ui.back()
        self.ui.wait(Selector(id='auth-screen'))

    def login(self, email: str = 'mika@example.test', password: str = 'PlayTime-test-123') -> None:
        if self.ui.find(Selector(id='chats-screen')) is not None:
            return
        self.ui.fill(Selector(id='auth-email'), email)
        self.ui.fill(Selector(id='auth-password'), password, hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(id='bottom-navigation'), 30)
        self.ui.checkpoint('conversations', self.ui.assert_safe('bottom-navigation'))

    def home(self, tab: str) -> None:
        self.ui.hide_keyboard()
        for _ in range(6):
            if self.ui.find(Selector(id=f'tab-{tab}')) is not None:
                self.ui.tap(Selector(id=f'tab-{tab}'))
                return
            self.ui.back()
        raise AssertionError('Could not reach bottom navigation')

    def auth(self) -> None:
        self.ui.checkpoint('auth-login')
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(contains='email'))
        self.ui.checkpoint('auth-validation')
        self.ui.fill(Selector(id='auth-email'), 'mika@example.test')
        self.ui.fill(Selector(id='auth-password'), 'Incorrect-password', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(contains='Неверный email или пароль'))
        self.ui.checkpoint('auth-invalid-credentials')
        self.ui.tap(Selector(id='auth-forgot'), True)
        self.ui.fill(Selector(id='auth-email'), 'mika@example.test', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(id='auth-code'))
        self.ui.checkpoint('auth-recovery-code')
        self.ui.fill(Selector(id='auth-code'), '000000')
        self.ui.fill(Selector(id='auth-password'), 'PlayTime-test-123')
        self.ui.fill(Selector(id='auth-repeat'), 'PlayTime-test-123', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(contains='Неверный или просроченный код'))
        self.ui.fill(Selector(id='auth-code'), '012345', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(description='Перейти ко входу'))
        self.ui.checkpoint('auth-recovery-success')
        self.ui.tap(Selector(id='auth-register'), True)
        self.ui.tap(Selector(id='auth-register'), True)
        self.ui.fill(Selector(id='auth-username'), 'AndroidTester')
        self.ui.fill(Selector(id='auth-email'), 'androidtester@example.test')
        self.ui.fill(Selector(id='auth-password'), 'PlayTime-test-123')
        self.ui.fill(Selector(id='auth-repeat'), 'PlayTime-test-123', hide=True)
        self.ui.tap(Selector(id='auth-legal'), True)
        self.ui.fill(Selector(id='auth-repeat'), 'Different-password', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(contains='Пароли не совпадают'))
        self.ui.checkpoint('auth-register-password-mismatch')
        self.ui.fill(Selector(id='auth-repeat'), 'PlayTime-test-123', hide=True)
        self.ui.checkpoint('auth-registration')
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(id='auth-code'))
        self.ui.fill(Selector(id='auth-code'), '000000', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(contains='Неверный или просроченный код'))
        self.ui.checkpoint('auth-verification-invalid-code')
        self.ui.fill(Selector(id='auth-code'), '012345', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(description='Перейти ко входу'))
        self.ui.checkpoint('auth-verification-success')
        self.ui.tap(Selector(id='auth-register'), True)
        self.login('  MIKA@example.test  ')

    def auth_finish(self) -> None:
        self.ui.wait(Selector(id='auth-code'))
        self.ui.fill(Selector(id='auth-code'), '000000', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(contains='Неверный или просроченный код'))
        self.ui.checkpoint('auth-verification-invalid-code')
        self.ui.fill(Selector(id='auth-code'), '012345', hide=True)
        self.ui.tap(Selector(id='auth-submit'), True)
        self.ui.wait(Selector(description='Перейти ко входу'))
        self.ui.checkpoint('auth-verification-success')
        self.ui.tap(Selector(id='auth-register'), True)
        self.login('  MIKA@example.test  ')

    def keyboard(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.fill(Selector(id='message-input'), 'Android keyboard overlap regression')
        self.ui.checkpoint('keyboard-layout-corrected', self.ui.assert_keyboard())
        self.ui.fill(Selector(id='message-input'), '', hide=True)

    def keyboard_modes(self) -> None:
        for mode in ['gestural', 'threebutton']:
            self.ui.run('shell', 'cmd', 'overlay', 'enable-exclusive', '--category', f'com.android.internal.systemui.navbar.{mode}')
            time.sleep(0.5)
            self.home('chats')
            self.ui.checkpoint(f'{mode}-navigation-safe-area', self.ui.assert_safe('bottom-navigation'))
            self.ui.tap(Selector(id='chat-Nova'))
            self.ui.fill(Selector(id='message-input'), f'{mode} keyboard layout regression')
            self.ui.checkpoint(f'{mode}-keyboard-corrected', {**self.ui.assert_keyboard(), **self.ui.assert_safe('back')})
            self.ui.fill(Selector(id='message-input'), '', hide=True)
            self.ui.checkpoint(f'{mode}-chat-safe-area', self.ui.assert_safe('back', 'chat-composer'))

    def chat(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.wait(Selector(id='message-input'))
        self.ui.checkpoint('chat-history')
        previous_messages = {item['id'] for item in self.state()['messages']}
        self.ui.fill(Selector(id='message-input'), 'Android e2e UniquePhrase')
        self.ui.checkpoint('chat-keyboard', self.ui.assert_keyboard())
        self.ui.tap(Selector(id='message-send'))
        state = self.until(lambda data: any(item['id'] not in previous_messages and item['senderId'] == 1 for item in data['messages']))
        sent = next(item for item in reversed(state['messages']) if item['id'] not in previous_messages and item['senderId'] == 1)
        message_id = sent['id']
        assert sent['content'].startswith('E2E1:') and 'UniquePhrase' not in sent['content'], 'Outgoing text is not encrypted'
        time.sleep(0.5)
        assert self.ui.keyboard_visible(), 'Sending text must keep the keyboard open'
        self.ui.run('shell', 'input', 'text', 'Follow-up%sdraft')
        self.ui.wait(Selector(text='Follow-up draft'))
        self.ui.checkpoint('chat-next-draft-without-refocus', self.ui.assert_keyboard())
        self.ui.fill(Selector(id='message-input'), '', hide=True)
        self.ui.wait(Selector(id=f'message-{message_id}'))
        self.ui.checkpoint('chat-sent')
        self.ui.hold(Selector(id=f'message-{message_id}'))
        self.ui.wait(Selector(id='chat-action-sheet'))
        self.ui.checkpoint('chat-message-actions')
        self.ui.tap(Selector(description='Редактировать'))
        self.ui.fill(Selector(id='message-input'), 'Android e2e edited UniquePhrase')
        self.ui.tap(Selector(id='message-send'))
        self.until(lambda data: any(item['event'] == 'message:edit' and item['payload'].get('id') == message_id for item in data['captured']))
        self.ui.hide_keyboard()
        self.ui.wait(Selector(contains='Android e2e edited UniquePhrase'))
        self.ui.hold(Selector(id=f'message-{message_id}'))
        self.ui.tap(Selector(description='Реакция 👍'))
        self.until(lambda data: any(item['id'] == message_id and any(reaction['emoji'] == '👍' for reaction in item.get('reactions', [])) for item in data['messages']))
        self.ui.hold(Selector(id=f'message-{message_id}'))
        self.ui.tap(Selector(description='Закрепить'))
        self.ui.checkpoint('chat-pinned')
        self.ui.hold(Selector(id=f'message-{message_id}'))
        self.ui.tap(Selector(description='Ответить'))
        self.ui.fill(Selector(id='message-input'), 'Reply from Android')
        self.ui.tap(Selector(id='message-send'))
        state = self.until(lambda data: data['messages'][-1].get('reply', {}).get('id') == message_id if data['messages'][-1].get('reply') else False)
        reply_id = state['messages'][-1]['id']
        self.ui.hide_keyboard()
        self.ui.checkpoint('chat-reply')
        self.ui.tap(Selector(id='chat-menu'))
        self.ui.tap(Selector(description='Поиск в переписке'))
        self.ui.fill(Selector(id='history-search'), 'UniquePhrase', hide=True)
        self.ui.checkpoint('chat-search')
        self.ui.back()
        self.ui.hold(Selector(id=f'message-{reply_id}'))
        self.ui.tap(Selector(description='Удалить у всех'))
        self.ui.tap(Selector(text='Удалить'))
        self.until(lambda data: not any(item['id'] == reply_id for item in data['messages']))
        self.ui.checkpoint('chat-message-deleted')
        self.ui.tap(Selector(id='chat-menu'))
        self.ui.tap(Selector(description='Профиль собеседника'))
        self.ui.wait(Selector(text='Nova'))
        self.ui.wait_absent(Selector(text='Загрузка…'))
        self.ui.checkpoint('peer-profile')
        before = len([item for item in self.state()['captured'] if item['event'] == 'message:markRead'])
        self.api('/__test/events', {'action': 'incomingMessage', 'text': 'Hidden-chat unread assertion'})
        time.sleep(1)
        after = len([item for item in self.state()['captured'] if item['event'] == 'message:markRead'])
        assert after == before, 'Hidden conversation sent a read receipt'
        self.ui.back()
        self.ui.wait(Selector(contains='Hidden-chat unread assertion'))
        self.ui.checkpoint('chat-return-unread')

    def media(self) -> None:
        previous_messages = {item['id'] for item in self.state()['messages']}
        self.ui.run('shell', 'pm', 'revoke', self.ui.package, 'android.permission.RECORD_AUDIO')
        self.ui.run('shell', 'pm', 'clear-permission-flags', self.ui.package, 'android.permission.RECORD_AUDIO', 'user-set', 'user-fixed')
        self.ui.run('shell', 'am', 'force-stop', self.ui.package)
        self.ui.run('shell', 'am', 'start', '-n', f'{self.ui.package}/.MainActivity')
        self.ui.wait(Selector(id='bottom-navigation'), 30)
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.fill(Selector(id='message-input'), '', hide=True)
        self.ui.wait(Selector(id='voice-record'))
        self.ui.tap(Selector(id='voice-record'))
        self.ui.wait(Selector(id='com.android.permissioncontroller:id/permission_deny_button'))
        self.ui.checkpoint('permission-microphone-rationale')
        self.ui.tap(Selector(id='com.android.permissioncontroller:id/permission_deny_button'))
        self.ui.checkpoint('permission-microphone-denied')
        self.ui.tap(Selector(id='voice-record'))
        rationale = self.ui.find(Selector(text='Продолжить'))
        if rationale is not None:
            self.ui.checkpoint('permission-microphone-explanation')
            self.ui.tap(Selector(text='Продолжить'))
        self.ui.wait(Selector(id='com.android.permissioncontroller:id/permission_allow_foreground_only_button'))
        self.ui.tap(Selector(id='com.android.permissioncontroller:id/permission_allow_foreground_only_button'))
        self.ui.wait(Selector(id='voice-send'))
        time.sleep(1.5)
        self.ui.checkpoint('voice-recording')
        self.ui.tap(Selector(id='voice-stop'))
        self.ui.wait(Selector(id='voice-preview'))
        self.ui.checkpoint('voice-preview-before-send')
        self.ui.tap(Selector(id='voice-preview-play'))
        time.sleep(0.5)
        self.ui.checkpoint('voice-preview-playing')
        self.ui.tap(Selector(id='voice-send'))
        state = self.until(lambda data: any(message['id'] not in previous_messages and message.get('voiceStorageKey') for message in data['messages']))
        voice_id = next(message['id'] for message in reversed(state['messages']) if message['id'] not in previous_messages and message.get('voiceStorageKey'))
        self.ui.wait_absent(Selector(id='voice-preview'))
        self.ui.wait(Selector(id=f'message-{voice_id}'))
        self.ui.checkpoint('voice-message-sent')
        sample = self.ui.output / 'Android-fixture.txt'
        sample.write_text('Native Android attachment e2e fixture\n', encoding='utf8')
        self.ui.run('push', str(sample), '/sdcard/Download/Android-fixture.txt')
        self.ui.tap(Selector(id='chat-attach'))
        self.ui.checkpoint('attachment-system-picker')
        self.ui.back()
        self.ui.wait(Selector(id='chat-screen'))
        self.ui.checkpoint('attachment-picker-cancelled')
        self.ui.tap(Selector(id='chat-attach'))
        self.pick_download('Android-fixture.txt')
        self.ui.wait(Selector(id='attachment-preview'))
        self.ui.checkpoint('attachment-preview')
        self.ui.tap(Selector(id='attachment-cancel'))
        self.ui.wait_absent(Selector(id='attachment-preview'))
        self.ui.tap(Selector(id='chat-attach'))
        self.pick_download('Android-fixture.txt')
        self.ui.tap(Selector(id='attachment-send'))
        state = self.until(lambda data: any(message['id'] not in previous_messages and message.get('attachmentKey') for message in data['messages']))
        attachment = next(message for message in reversed(state['messages']) if message.get('attachmentKey'))
        upload = next(upload for upload in state['uploads'] if upload['key'] == attachment['attachmentKey'])
        assert upload['bytes'] == sample.stat().st_size + 16, 'Attachment upload is not a NaCl authenticated ciphertext'
        self.ui.wait_absent(Selector(id='attachment-preview'))
        self.ui.wait(Selector(id=f"message-{attachment['id']}"))
        self.ui.checkpoint('attachment-sent')
        self.ui.tap(Selector(description='Сохранить'), True)
        self.ui.wait(Selector(text='SAVE'))
        self.ui.checkpoint('attachment-decrypted-save-dialog')
        self.ui.back()
        self.ui.wait(Selector(id='chat-screen'))
        self.ui.tap(Selector(description='Поделиться'), True)
        self.ui.wait(Selector(contains='Sharing 1 file'))
        time.sleep(0.5)
        self.ui.checkpoint('attachment-android-share-sheet')
        self.ui.back()

    def friends(self) -> None:
        self.home('friends')
        self.ui.wait(Selector(id='friends-screen'))
        self.ui.checkpoint('friends-list')
        self.ui.fill(Selector(id='friend-username'), 'DoesNotExist', hide=True)
        self.ui.tap(Selector(id='friend-request'))
        self.ui.wait(Selector(contains='Пользователь не найден'))
        self.ui.checkpoint('friends-not-found')
        self.ui.tap(Selector(contains='Заявки ·'), True)
        self.ui.tap(Selector(id='accept-Luna'), True)
        self.until(lambda data: any(friend['user_id'] == 4 and friend['friend_id'] == 1 and friend['status'] == 'accepted' for friend in data['friendships']))
        self.ui.checkpoint('friends-accepted')
        self.ui.tap(Selector(description='Отменить'), True)
        self.ui.tap(Selector(text='Отменить заявку'))
        self.until(lambda data: not any(friend['user_id'] == 1 and friend['friend_id'] == 5 for friend in data['friendships']))
        self.ui.fill(Selector(id='friend-username'), 'Echo', hide=True)
        self.ui.tap(Selector(id='friend-request'), True)
        self.until(lambda data: any(friend['user_id'] == 1 and friend['friend_id'] == 5 for friend in data['friendships']))
        self.ui.checkpoint('friends-outgoing')

    def rooms(self) -> None:
        self.home('rooms')
        self.ui.checkpoint('rooms-list')
        self.ui.tap(Selector(id='new-conversation'))
        self.ui.wait(Selector(id='room-name'))
        self.ui.fill(Selector(id='room-name'), 'ab', hide=True)
        self.ui.tap(Selector(id='room-create'), True)
        self.ui.checkpoint('room-create-validation')
        self.ui.fill(Selector(id='room-name'), 'Android room', hide=True)
        self.ui.tap(Selector(id='room-create'))
        self.ui.wait(Selector(id='chat-screen'))
        self.ui.fill(Selector(id='message-input'), 'Encrypted room message')
        self.ui.tap(Selector(id='message-send'))
        state = self.until(lambda data: data['messages'][-1].get('roomId', 0) >= 20)
        room_id = state['messages'][-1]['roomId']
        assert state['messages'][-1]['content'].startswith('R2E1:'), 'Room text is not encrypted'
        self.ui.hide_keyboard()
        self.ui.checkpoint('room-chat')
        self.ui.tap(Selector(id='chat-menu'))
        self.ui.tap(Selector(description='Участники и настройки'))
        self.ui.wait(Selector(id='room-settings-screen'))
        self.ui.checkpoint('room-settings')
        self.ui.fill(Selector(id='room-rename-input'), 'Renamed room', hide=True)
        self.ui.tap(Selector(id='room-rename'))
        self.until(lambda data: any(room['id'] == room_id and room['name'] == 'Renamed room' for room in data['rooms']))
        self.ui.tap(Selector(id='room-invite'), True)
        self.ui.tap(Selector(description='Nova'), True)
        self.ui.tap(Selector(id='room-invite-submit'), True)
        self.until(lambda data: any(room['id'] == room_id and any(member['username'] == 'Nova' for member in room['members']) for room in data['rooms']))
        self.ui.tap(Selector(description='Управление Nova'), True)
        self.ui.tap(Selector(description='Назначить модератором'), True)
        self.until(lambda data: any(room['id'] == room_id and any(member['username'] == 'Nova' and member['role'] == 'moderator' for member in room['members']) for room in data['rooms']))
        self.ui.checkpoint('room-moderator')
        self.ui.tap(Selector(description='Управление Nova'), True)
        self.ui.tap(Selector(description='Удалить участника'), True)
        self.ui.tap(Selector(text='Удалить'))
        self.until(lambda data: any(room['id'] == room_id and len(room['members']) == 1 for room in data['rooms']))
        self.ui.tap(Selector(id='room-leave'), True)
        self.ui.tap(Selector(text='Удалить'))
        self.until(lambda data: not any(room['id'] == room_id for room in data['rooms']))
        self.ui.checkpoint('room-deleted')

    def navigation(self) -> None:
        self.home('chats')
        self.ui.wait(Selector(text='Диалоги'))
        self.ui.absent(Selector(contains='На связи с теми, кто рядом'))
        self.ui.absent(Selector(text='Все разговоры'))
        self.ui.absent(Selector(text='Непрочитанные'))
        self.ui.absent(Selector(id='conversation-search'))
        search = self.ui.wait(Selector(id='conversation-search-toggle'))
        create = self.ui.wait(Selector(id='new-conversation'))
        assert self.ui.bounds(search)[2] <= self.ui.bounds(create)[0], 'Search must precede plus'
        self.ui.checkpoint('dialogs-clean-list')
        self.api('/__test/events', {'action': 'incomingMessage', 'from': 'Nova', 'text': 'UNREAD ASSERTION'})
        self.ui.tap(Selector(id='conversation-search-toggle'))
        self.ui.wait(Selector(id='conversation-search'))
        deadline = time.monotonic() + 3
        while not self.ui.keyboard_visible() and time.monotonic() < deadline:
            time.sleep(0.1)
        assert self.ui.keyboard_visible(), 'Opening search should focus the input'
        self.ui.checkpoint('dialogs-search-expanded')
        self.ui.fill(Selector(id='conversation-search'), 'UNREAD ASSERTION', hide=True)
        self.ui.wait(Selector(id='chat-Nova'))
        self.ui.absent(Selector(id='chat-Orbit'))
        time.sleep(0.6)
        self.ui.checkpoint('conversation-search-decrypted-preview')
        self.ui.fill(Selector(id='conversation-search'), 'NoConversationMatches', hide=True)
        self.ui.wait(Selector(contains='Ничего не найдено'))
        self.ui.checkpoint('conversation-search-empty')
        self.ui.fill(Selector(id='conversation-search'), '', hide=True)
        self.ui.wait(Selector(id='chat-Orbit'))
        self.api('/__test/events', {'action': 'incomingMessage', 'from': 'Orbit', 'text': 'Unread from Orbit'})
        self.ui.wait(Selector(description='Чат Orbit, 1 непрочитанных'))
        self.ui.wait(Selector(id='chat-Orbit'))
        orbit = self.ui.wait(Selector(id='chat-Orbit'))
        nova = self.ui.wait(Selector(id='chat-Nova'))
        assert self.ui.bounds(orbit)[1] < self.ui.bounds(nova)[1], 'Latest incoming message must move its dialog above the previous one'
        self.ui.checkpoint('conversation-newest-first')
        self.ui.tap(Selector(id='chat-Orbit'))
        self.ui.wait(Selector(contains='Unread from Orbit'))
        self.ui.back()
        self.ui.wait(Selector(description='Чат Orbit'))
        self.ui.checkpoint('conversation-read-clears-badge')
        self.ui.tap(Selector(id='conversation-search-toggle'))
        self.ui.fill(Selector(id='conversation-search'), 'NoConversationMatches', hide=True)
        self.ui.tap(Selector(id='conversation-search-toggle'))
        self.ui.wait_absent(Selector(id='conversation-search'))
        self.ui.wait(Selector(id='chat-Orbit'))
        self.ui.wait(Selector(id='chat-Nova'))
        self.ui.checkpoint('dialogs-search-closed-resets-query')

    def room_ownership(self) -> None:
        self.home('rooms')
        self.ui.tap(Selector(id='new-conversation'))
        self.ui.fill(Selector(id='room-name'), 'Transfer room', hide=True)
        self.ui.tap(Selector(id='room-create'))
        self.ui.wait(Selector(id='chat-screen'))
        state = self.until(lambda data: any(room['name'] == 'Transfer room' for room in data['rooms']))
        room_id = next(room['id'] for room in state['rooms'] if room['name'] == 'Transfer room')
        self.ui.fill(Selector(id='message-input'), 'Reader proof')
        self.ui.tap(Selector(id='message-send'))
        state = self.until(lambda data: any(item.get('roomId') == room_id for item in data['messages']))
        message = next(item for item in reversed(state['messages']) if item.get('roomId') == room_id)
        self.ui.hide_keyboard()
        self.ui.hold(Selector(id=f"message-{message['id']}"))
        self.ui.tap(Selector(description='Кто прочитал'))
        self.ui.wait(Selector(text='Mika'))
        self.ui.checkpoint('room-readers-receipt')
        self.ui.tap(Selector(description='Закрыть'))
        self.ui.tap(Selector(id='chat-menu'))
        self.ui.tap(Selector(description='Участники и настройки'))
        self.ui.tap(Selector(id='room-invite'), True)
        self.ui.tap(Selector(description='Nova'), True)
        self.ui.tap(Selector(id='room-invite-submit'), True)
        self.ui.tap(Selector(description='Управление Nova'), True)
        self.ui.tap(Selector(description='Передать владение'), True)
        self.ui.tap(Selector(text='Передать'))
        self.until(lambda data: any(room['id'] == room_id and room['created_by'] == 2 for room in data['rooms']))
        self.ui.wait(Selector(contains='вы участник'))
        self.ui.absent(Selector(id='room-rename-input'))
        self.ui.checkpoint('room-ownership-transferred')
        self.ui.tap(Selector(id='room-leave'), True)
        self.ui.tap(Selector(text='Покинуть'))
        self.until(lambda data: any(room['id'] == room_id and not any(member['id'] == 1 for member in room['members']) for room in data['rooms']))
        self.ui.checkpoint('room-member-left')

    def appearance(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.tap(Selector(id='chat-menu'))
        self.ui.tap(Selector(description='Фон переписки'))
        self.ui.wait(Selector(id='wallpaper-screen'))
        self.ui.checkpoint('wallpaper-options')
        self.ui.tap(Selector(description='Океан'), True)
        self.ui.tap(Selector(id='wallpaper-save'), True)
        self.until(lambda data: any(item['event'] == 'dmWallpaper:set' and item['payload'].get('state', {}).get('id') == 'ocean' for item in data['captured']))
        self.ui.wait(Selector(id='chat-screen'))
        self.ui.checkpoint('chat-wallpaper-applied')
        self.api('/__test/events', {'event': 'chat:typing', 'userId': 1, 'payload': {'fromUsername': 'Nova', 'dmPeer': 'Nova', 'typing': True}})
        self.ui.wait(Selector(contains='печатает'))
        self.ui.checkpoint('chat-typing-indicator')
        self.ui.tap(Selector(id='chat-menu'))
        self.ui.tap(Selector(description='Защита переписки'))
        self.ui.checkpoint('chat-encryption-details')
        self.ui.back()

    def safety(self) -> None:
        self.home('friends')
        self.ui.tap(Selector(description='Профиль Luna'), True)
        self.ui.wait(Selector(id='peer-profile-screen'))
        self.ui.tap(Selector(description='Пожаловаться'), True)
        self.ui.fill(Selector(id='report-reason'), 'Android local fixture report', hide=True)
        self.ui.tap(Selector(id='report-submit'), True)
        self.until(lambda data: any(item.get('reason') == 'Android local fixture report' for item in data['reports']))
        self.ui.checkpoint('safety-report-sent')
        self.ui.tap(Selector(description='Заблокировать'), True)
        self.ui.tap(Selector(text='Заблокировать'))
        self.ui.wait(Selector(description='Разблокировать'))
        self.ui.checkpoint('safety-user-blocked')
        self.safety_unblock()

    def safety_unblock(self) -> None:
        self.home('profile')
        self.ui.tap(Selector(contains='Заблокированные'), True)
        self.ui.wait(Selector(id='blocked-users-screen'))
        self.ui.wait(Selector(text='Luna'))
        self.ui.checkpoint('safety-blocked-list')
        self.ui.tap(Selector(description='Разблокировать'), True)
        self.ui.tap(Selector(text='Разблокировать'))
        self.ui.wait(Selector(contains='Здесь пока никого'))
        self.ui.checkpoint('safety-unblocked')
        self.ui.back()

    def profile(self) -> None:
        self.home('profile')
        self.ui.wait(Selector(id='profile-screen'))
        self.ui.checkpoint('profile-overview')
        self.ui.tap(Selector(id='edit-profile'), True)
        self.ui.fill(Selector(id='profile-status'), 'Online from Android')
        self.ui.fill(Selector(id='profile-bio'), 'Native app, safe areas and keyboard checked.', hide=True)
        self.ui.checkpoint('profile-editor')
        self.ui.tap(Selector(id='profile-save'), True)
        self.ui.wait(Selector(contains='Сохран'))
        self.ui.tap(Selector(contains='Оформление'), True)
        self.ui.checkpoint('profile-appearance')
        self.ui.run('push', str(ROOT.parent / 'public' / 'assets' / 'smile.jpg'), '/sdcard/Download/PlayTime-avatar.jpg')
        self.ui.tap(Selector(description='Выбрать фото'), True)
        self.pick_download('PlayTime-avatar.jpg')
        self.ui.tap(Selector(description='Орбита'), True)
        self.ui.tap(Selector(description='Выбрать баннер'), True)
        self.pick_download('PlayTime-avatar.jpg')
        self.ui.tap(Selector(description='Сакура'), True)
        self.ui.tap(Selector(description='🚀'), True)
        self.ui.tap(Selector(id='profile-save'), True)
        self.until(lambda data: any(item['event'] == 'profile:update' and item['payload'].get('profileAvatarEffect') == 'orbit' and item['payload'].get('profileBannerSticker') == 'rocket' and item['payload'].get('avatar', '').startswith('data:image/') for item in data['captured']))
        self.ui.checkpoint('profile-photo-effects-saved')
        self.ui.back()
        self.ui.wait(Selector(id='profile-screen'))
        self.ui.checkpoint('profile-saved')

    def account(self) -> None:
        self.home('profile')
        self.ui.tap(Selector(contains='Аккаунт и безопасность'), True)
        self.ui.checkpoint('account-security')
        self.ui.tap(Selector(id='account-sessions'), True)
        self.ui.wait(Selector(contains='PlayTime · macOS'))
        self.ui.checkpoint('account-sessions')
        self.ui.tap(Selector(description='Отключить устройство'), True)
        self.ui.tap(Selector(id='session-request-code'), True)
        self.ui.wait(Selector(id='session-code'))
        self.ui.fill(Selector(id='session-code'), '000000', hide=True)
        self.ui.tap(Selector(id='session-confirm'), True)
        self.ui.wait(Selector(contains='Неверный или просроченный код'))
        self.ui.checkpoint('session-invalid-code')
        self.ui.fill(Selector(id='session-code'), '012345', hide=True)
        self.ui.tap(Selector(id='session-confirm'), True)
        self.until(lambda data: not any(item['deviceName'] == 'PlayTime · macOS' for item in data['sessions']))
        self.ui.wait_absent(Selector(id='session-code'))
        self.ui.wait_absent(Selector(contains='PlayTime · macOS'))
        self.ui.checkpoint('session-revoked')
        self.ui.back()
        self.ui.tap(Selector(id='account-password'), True)
        self.ui.fill(Selector(id='password-current'), 'wrong')
        self.ui.fill(Selector(id='password-new'), 'PlayTime-test-123')
        self.ui.fill(Selector(id='password-repeat'), 'mismatch', hide=True)
        self.ui.tap(Selector(id='password-submit'), True)
        self.ui.checkpoint('password-validation')
        self.ui.back()
        self.ui.tap(Selector(id='account-backup'), True)
        self.ui.run('shell', 'rm', '-f', '/sdcard/Download/playtime-keys-1.json')
        self.ui.checkpoint('key-backup')
        self.ui.fill(Selector(id='keys-password'), 'Backup-Android-123')
        self.ui.fill(Selector(id='keys-password-repeat'), 'Different-value', hide=True)
        self.ui.tap(Selector(id='keys-submit'), True)
        self.ui.wait(Selector(contains='Пароли не совпадают'))
        self.ui.fill(Selector(id='keys-password-repeat'), 'Backup-Android-123', hide=True)
        self.ui.tap(Selector(id='keys-submit'), True)
        self.ui.wait(Selector(text='SAVE'))
        save_menu = self.ui.find(Selector(description='Show roots'))
        if save_menu is not None:
            self.ui.tap(Selector(description='Show roots'))
            self.ui.tap(Selector(text='Downloads'), True)
        self.ui.checkpoint('key-backup-native-save-dialog')
        self.ui.tap(Selector(text='SAVE'))
        replace = self.ui.find(Selector(text='Replace'))
        if replace is not None:
            self.ui.tap(Selector(text='Replace'))
        self.ui.wait(Selector(id='keys-done'), 30)
        self.ui.checkpoint('key-backup-saved')
        self.ui.run('pull', '/sdcard/Download/playtime-keys-1.json', str(self.ui.output / 'playtime-keys-1.json'))
        backup = json.loads((self.ui.output / 'playtime-keys-1.json').read_text())
        assert backup['format'] == 'playtime-key-backup-v1', 'Unexpected backup envelope'
        assert 'ciphertext' in backup and 'keys' not in backup, 'Backup must contain authenticated ciphertext only'
        self.ui.tap(Selector(id='keys-done'))
        self.account_restore()

    def account_restore(self) -> None:
        self.home('profile')
        self.ui.tap(Selector(contains='Аккаунт и безопасность'), True)
        self.ui.tap(Selector(id='account-restore'), True)
        self.ui.checkpoint('key-restore')
        self.ui.tap(Selector(id='keys-select-file'), True)
        self.pick_download('playtime-keys-1.json')
        self.ui.fill(Selector(id='keys-password'), 'Incorrect-passphrase', hide=True)
        self.ui.tap(Selector(id='keys-submit'), True)
        self.ui.tap(Selector(text='Восстановить'))
        self.ui.wait(Selector(contains='Не удалось открыть копию: проверьте пароль и файл'))
        self.ui.checkpoint('key-restore-wrong-password')
        self.ui.fill(Selector(id='keys-password'), 'Backup-Android-123', hide=True)
        self.ui.tap(Selector(id='keys-submit'), True)
        self.ui.tap(Selector(text='Восстановить'))
        self.ui.wait(Selector(id='keys-done'), 30)
        self.ui.checkpoint('key-restore-success')
        self.ui.tap(Selector(id='keys-done'))
        self.ui.tap(Selector(id='account-transfer'), True)
        self.ui.checkpoint('key-transfer')
        self.ui.tap(Selector(id='transfer-create'), True)
        code = self.ui.wait(Selector(id='transfer-code')).attrib['text']
        assert len(code) > 50, 'Transfer code is incomplete'
        self.ui.checkpoint('key-transfer-created')
        self.ui.tap(Selector(id='transfer-copy'), True)
        self.ui.wait(Selector(contains='Код скопирован'))
        self.ui.tap(Selector(text='На это устройство'), True)
        self.ui.fill(Selector(id='transfer-input'), code, hide=True)
        self.ui.tap(Selector(id='transfer-receive'), True)
        self.ui.tap(Selector(text='Перенести ключи'))
        self.ui.wait(Selector(id='transfer-done'))
        self.ui.checkpoint('key-transfer-received')
        self.ui.tap(Selector(id='transfer-done'))
        self.ui.tap(Selector(id='account-transfer'), True)
        self.ui.tap(Selector(text='На это устройство'), True)
        self.ui.fill(Selector(id='transfer-input'), code, hide=True)
        self.ui.tap(Selector(id='transfer-receive'), True)
        self.ui.tap(Selector(text='Перенести ключи'))
        self.ui.wait(Selector(contains='Код истёк или уже использован'))
        self.ui.checkpoint('key-transfer-cannot-reuse')
        self.ui.back()
        self.ui.tap(Selector(id='account-delete'), True)
        self.ui.checkpoint('account-delete-confirmation')
        self.ui.fill(Selector(id='delete-password'), 'PlayTime-test-123', hide=True)
        self.ui.tap(Selector(id='delete-prepare'), True)
        self.ui.tap(Selector(text='Продолжить удаление'))
        self.ui.hold(Selector(id='delete-hold'), milliseconds=700)
        self.ui.wait(Selector(id='delete-hold'))
        assert any(user['username'] == 'Mika' for user in self.state()['users']), 'Early hold must not delete account'
        self.ui.checkpoint('account-delete-hold-cancelled')
        self.ui.tap(Selector(description='Отменить удаление'), True)
        self.ui.back()

    def pick_download(self, filename: str) -> None:
        self.ui.wait(Selector(description='Show roots'))
        if self.ui.find(Selector(description='List view')) is not None:
            self.ui.tap(Selector(description='List view'))
            time.sleep(0.4)
        if self.ui.find(Selector(text=filename)) is None:
            self.ui.tap(Selector(description='Show roots'))
            self.ui.wait(Selector(text='Downloads'))
            time.sleep(0.6)
            self.ui.tap(Selector(text='Downloads'))
            self.ui.wait(Selector(id='com.google.android.documentsui:id/breadcrumb_text', text='Downloads'))
            time.sleep(0.4)
            if self.ui.find(Selector(description='List view')) is not None:
                self.ui.tap(Selector(description='List view'))
                time.sleep(0.4)
        self.ui.wait(Selector(text=filename))
        time.sleep(0.4)
        self.ui.tap(Selector(text=filename), True)

    def resilience(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.fill(Selector(id='message-input'), 'Draft survives restart', hide=True)
        self.api('/__test/events', {'action': 'disconnect'})
        self.ui.wait(Selector(id='connection-banner'))
        send = self.ui.wait(Selector(id='message-send'))
        assert send.attrib.get('enabled') == 'false', 'Sending must be unavailable while disconnected'
        self.ui.checkpoint('offline-preserves-draft')
        self.ui.tap(Selector(id='connection-banner'))
        self.ui.wait_absent(Selector(id='connection-banner'), 30)
        self.ui.wait(Selector(text='Draft survives restart'))
        self.ui.checkpoint('reconnected-preserves-chat')
        self.ui.run('shell', 'am', 'force-stop', self.ui.package)
        self.ui.run('shell', 'am', 'start', '-n', f'{self.ui.package}/.MainActivity')
        self.ui.wait(Selector(id='bottom-navigation'), 30)
        self.ui.absent(Selector(id='auth-screen'))
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.wait(Selector(text='Draft survives restart'))
        self.ui.checkpoint('secure-session-and-draft-after-restart')
        self.ui.fill(Selector(id='message-input'), '', hide=True)

    def password(self) -> None:
        self.home('profile')
        self.ui.tap(Selector(contains='Аккаунт и безопасность'), True)
        self.ui.tap(Selector(id='account-password'), True)
        self.ui.fill(Selector(id='password-current'), 'Wrong-current-password')
        self.ui.fill(Selector(id='password-new'), 'PlayTime-test-123')
        self.ui.fill(Selector(id='password-repeat'), 'PlayTime-test-123', hide=True)
        self.ui.tap(Selector(id='password-submit'), True)
        self.ui.tap(Selector(text='Сменить пароль'))
        self.ui.wait(Selector(contains='Неверный текущий пароль'))
        self.ui.checkpoint('password-current-invalid')
        self.ui.fill(Selector(id='password-current'), 'PlayTime-test-123', hide=True)
        self.ui.tap(Selector(id='password-submit'), True)
        self.ui.tap(Selector(text='Сменить пароль'))
        self.ui.wait(Selector(id='auth-email'))
        self.ui.checkpoint('password-changed-and-session-revoked')
        self.login()

    def delete_account(self) -> None:
        assert any(user['username'] == 'AndroidTester' for user in self.state()['users']), 'Run auth group first to create the isolated account for deletion'
        self.home('profile')
        self.ui.tap(Selector(description='Выйти из аккаунта'), True)
        self.ui.tap(Selector(text='Выйти'))
        self.ui.wait(Selector(id='auth-screen'))
        self.login('androidtester@example.test')
        self.home('profile')
        self.ui.tap(Selector(contains='Аккаунт и безопасность'), True)
        self.ui.tap(Selector(id='account-delete'), True)
        self.ui.fill(Selector(id='delete-password'), 'Wrong-password', hide=True)
        self.ui.tap(Selector(id='delete-prepare'), True)
        self.ui.tap(Selector(text='Продолжить удаление'))
        self.ui.hold(Selector(id='delete-hold'), milliseconds=3300)
        self.ui.wait(Selector(contains='Неверный пароль'))
        self.ui.checkpoint('account-delete-wrong-password')
        self.ui.fill(Selector(id='delete-password'), 'PlayTime-test-123', hide=True)
        self.ui.tap(Selector(id='delete-prepare'), True)
        self.ui.tap(Selector(text='Продолжить удаление'))
        self.ui.hold(Selector(id='delete-hold'), milliseconds=3300)
        self.ui.wait(Selector(id='auth-screen'))
        self.until(lambda data: not any(user['username'] == 'AndroidTester' for user in data['users']))
        self.ui.checkpoint('account-deleted-after-confirmed-hold')
        self.login()

    def settings(self) -> None:
        self.home('profile')
        self.ui.tap(Selector(description='Настройки'))
        self.ui.wait(Selector(id='settings-screen'))
        self.ui.checkpoint('settings')
        self.ui.tap(Selector(id='notifications-toggle'), True)
        time.sleep(0.5)
        allow = self.ui.find(Selector(id='com.android.permissioncontroller:id/permission_allow_button'))
        if allow is not None:
            self.ui.checkpoint('permission-notifications')
            self.ui.tap(Selector(id='com.android.permissioncontroller:id/permission_allow_button'))
        self.ui.checkpoint('settings-notifications-enabled')
        self.ui.back()
        self.home('chats')
        self.ui.run('shell', 'cmd', 'overlay', 'enable', 'com.android.internal.systemui.navbar.threebutton')
        time.sleep(0.5)
        self.ui.checkpoint('three-button-navigation', self.ui.assert_safe('bottom-navigation'))
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.fill(Selector(id='message-input'), 'Three-button navigation keyboard test')
        self.ui.checkpoint('three-button-keyboard', self.ui.assert_keyboard())
        self.ui.fill(Selector(id='message-input'), '', hide=True)
        self.ui.back()

    def run_group(self, name: str) -> None:
        started = time.monotonic()
        print(f'RUN {name}', flush=True)
        try:
            getattr(self, name)()
            self.results.append({'group': name, 'status': 'passed', 'seconds': round(time.monotonic() - started, 2)})
            print(f'PASS {name}', flush=True)
        except Exception as error:
            self.ui.checkpoint(f'{name}-failure', {'error': str(error)})
            self.results.append({'group': name, 'status': 'failed', 'seconds': round(time.monotonic() - started, 2), 'error': str(error)})
            raise
        finally:
            report = {'package': self.ui.package, 'device': self.ui.serial, 'groups': self.results, 'checkpoints': self.ui.checkpoints}
            (self.ui.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=4), encoding='utf8')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--adb', default=os.environ.get('ADB', DEFAULT_ADB))
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--package', default='com.playtimemobile')
    parser.add_argument('--fixture', default='http://127.0.0.1:1502')
    parser.add_argument('--output', type=Path, default=ROOT / 'e2e' / 'artifacts' / time.strftime('%Y%m%d-%H%M%S'))
    parser.add_argument('--groups', default='auth,keyboard_modes,chat,navigation,appearance,media,friends,rooms,room_ownership,profile,account,safety,settings,resilience,password,delete_account')
    parser.add_argument('--fresh', action='store_true', help='Clear only the test app on the local emulator and reset local fixture')
    parser.add_argument('--login', action='store_true', help='Log in through UI before selected groups')
    parser.add_argument('--snapshot', help='Capture one screenshot and UI hierarchy without clicking')
    args = parser.parse_args()
    ui = AndroidUI(args.adb, args.serial, args.output, args.package)
    if args.snapshot:
        ui.checkpoint(args.snapshot)
        return 0
    suite = Suite(ui, args.fixture)
    try:
        if args.fresh:
            suite.reset()
        if args.login:
            suite.login()
        for group in args.groups.split(','):
            suite.run_group(group)
    except Exception as error:
        print(f'FAILED: {error}', file=sys.stderr, flush=True)
        return 1
    print(f'All selected native UI scenarios passed. Evidence: {args.output}', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
