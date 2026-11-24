#!/usr/bin/env python3
"""Native shared wallpaper presets, image ranges, failure recovery and realtime update."""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import sys
import time

SPEC = importlib.util.spec_from_file_location('playtime_wallpaper_ui', Path(__file__).with_name('run-ui.py'))
assert SPEC and SPEC.loader
UI = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = UI
SPEC.loader.exec_module(UI)
Selector = UI.Selector


class WallpaperSuite(UI.Suite):
    def editor(self) -> None:
        self.ui.tap(Selector(id='chat-menu'))
        self.ui.tap(Selector(description='Фон переписки'))
        self.ui.wait(Selector(id='wallpaper-screen'))

    def preview(self, name: str) -> None:
        for _ in range(4):
            self.ui.scroll('up')
        self.ui.wait(Selector(contains='Этот фон виден нам обоим?'))
        time.sleep(0.3)
        self.ui.checkpoint(name)

    def save(self, kind: str, **expected: object) -> dict:
        previous = len(self.state()['captured'])
        self.ui.tap(Selector(id='wallpaper-save'), True)
        state = self.until(lambda data: any(event['event'] == 'dmWallpaper:set' for event in data['captured'][previous:]))
        payload = next(event['payload']['state'] for event in reversed(state['captured']) if event['event'] == 'dmWallpaper:set')
        assert payload['kind'] == kind, payload
        for key, value in expected.items():
            assert payload[key] == value, payload
        self.ui.wait(Selector(id='chat-screen'))
        return payload

    def range(self, label: str, value: int) -> None:
        node = self.ui.locate(Selector(description=label), True)
        left, top, right, bottom = self.ui.bounds(node)
        x = left + 1 if value == 0 else right - 1
        self.ui.run('shell', 'input', 'tap', str(x), str((top + bottom) // 2))
        time.sleep(0.2)

    def presets(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.editor()
        presets = [('aurora', 'Сияние'), ('dusk', 'Закат'), ('ocean', 'Океан'), ('warm', 'Тепло'), ('forest', 'Лес'), ('mono', 'Графит'), ('rose', 'Роза'), ('slate', 'Сланец')]
        for key, title in presets:
            self.ui.tap(Selector(description=title), True)
            assert self.ui.wait(Selector(description=title)).attrib['checked'] == 'true'
            self.preview('wallpaper-preset-' + key)
        self.ui.tap(Selector(description='Океан'), True)
        self.save('preset', id='ocean')
        self.ui.checkpoint('wallpaper-ocean-saved-to-chat')

    def custom(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.editor()
        self.ui.run('push', str(UI.ROOT.parent / 'public' / 'assets' / 'smile.jpg'), '/sdcard/Download/Wallpaper-image.jpg')
        self.ui.tap(Selector(description='Выбрать своё изображение'), True)
        self.pick_download('Wallpaper-image.jpg')
        self.ui.locate(Selector(description='Затемнение'), True)
        self.preview('wallpaper-custom-image-preview')
        self.range('Затемнение', 0)
        self.range('Размытие', 0)
        assert sum(node.attrib.get('text') == '0%' for node in self.ui.tree().iter('node')) == 2
        self.ui.checkpoint('wallpaper-image-zero-controls')
        self.preview('wallpaper-image-zero-dim-blur')
        self.range('Затемнение', 100)
        self.range('Размытие', 100)
        assert sum(node.attrib.get('text') == '100%' for node in self.ui.tree().iter('node')) == 2
        self.ui.checkpoint('wallpaper-image-maximum-controls')
        payload = self.save('image', dim=100, blur=100)
        assert payload['dataUrl'].startswith('data:image/')
        self.ui.checkpoint('wallpaper-image-maximum-saved')
        self.editor()
        self.ui.tap(Selector(description='Без фона'), True)
        self.api('/__test/events', {'action': 'socketFailure', 'event': 'dmWallpaper:set', 'message': 'Тест: фон временно не сохранён'})
        try:
            self.ui.tap(Selector(id='wallpaper-save'), True)
            self.ui.wait(Selector(contains='фон временно не сохранён'))
            self.ui.wait(Selector(id='wallpaper-screen'))
            self.ui.checkpoint('wallpaper-save-failure-retains-editor')
        finally:
            self.api('/__test/events', {'action': 'clearFailures'})
        self.save('none')
        self.ui.checkpoint('wallpaper-reset-after-error-retry')
        self.api('/__test/events', {'event': 'dmWallpaper:update', 'userId': 1, 'payload': {'peerUsername': 'Nova', 'state': {'kind': 'preset', 'id': 'rose'}}})
        time.sleep(0.5)
        self.ui.checkpoint('wallpaper-remote-live-update')
        self.editor()
        assert self.ui.locate(Selector(description='Роза'), True).attrib['checked'] == 'true'
        self.ui.checkpoint('wallpaper-remote-state-in-editor')
        self.ui.tap(Selector(description='Без фона'), True)
        self.save('none')
        self.ui.checkpoint('wallpaper-final-reset')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--adb', default=UI.DEFAULT_ADB)
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--fixture', default='http://127.0.0.1:1502')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--groups', default='presets,custom')
    args = parser.parse_args()
    ui = UI.AndroidUI(args.adb, args.serial, args.output, 'com.playtimemobile')
    suite = WallpaperSuite(ui, args.fixture)
    try:
        for group in args.groups.split(','):
            suite.run_group(group)
    except Exception as error:
        print(f'FAILED: {error}', file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
