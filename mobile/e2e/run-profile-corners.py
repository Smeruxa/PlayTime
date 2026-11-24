#!/usr/bin/env python3
"""Verify every profile decoration through the native editor and plan restrictions."""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import sys
import time

SPEC = importlib.util.spec_from_file_location('playtime_profile_ui', Path(__file__).with_name('run-ui.py'))
assert SPEC and SPEC.loader
UI = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = UI
SPEC.loader.exec_module(UI)
Selector = UI.Selector


class ProfileCorners(UI.Suite):
    def editor(self) -> None:
        self.home('profile')
        self.ui.tap(Selector(id='edit-profile'), True)
        self.ui.wait(Selector(id='profile-editor-screen'))

    def preview(self, name: str) -> None:
        for _ in range(7):
            self.ui.scroll('up')
        self.ui.wait(Selector(contains='Оформление'))
        time.sleep(0.5)
        self.ui.checkpoint(name)

    def save(self, field: str, value: str | None) -> None:
        previous = len([event for event in self.state()['captured'] if event['event'] == 'profile:update'])
        self.ui.tap(Selector(id='profile-save'), True)
        self.until(lambda state: len([event for event in state['captured'] if event['event'] == 'profile:update']) > previous and [event for event in state['captured'] if event['event'] == 'profile:update'][-1]['payload'].get(field) == value)
        self.ui.wait(Selector(contains='Профиль сохранён'))

    def prepare(self) -> None:
        self.api('/__test/events', {'action': 'plan', 'planSlug': 'pro'})
        self.editor()
        self.ui.tap(Selector(contains='Оформление'), True)
        self.ui.run('push', str(UI.ROOT.parent / 'public' / 'assets' / 'smile.jpg'), '/sdcard/Download/PlayTime-avatar.jpg')
        self.ui.tap(Selector(description='Выбрать фото'), True)
        self.pick_download('PlayTime-avatar.jpg')
        self.ui.tap(Selector(description='Выбрать баннер'), True)
        self.pick_download('PlayTime-avatar.jpg')
        save = self.ui.locate(Selector(id='profile-save'), True)
        if save.attrib.get('enabled') != 'false':
            self.ui.tap(Selector(id='profile-save'), True)
            self.ui.wait(Selector(contains='Профиль сохранён'))
        self.preview('profile-images-prepared')
        self.ui.back()

    def decorations(self) -> None:
        self.api('/__test/events', {'action': 'plan', 'planSlug': 'pro'})
        self.editor()
        self.ui.tap(Selector(contains='Оформление'), True)
        groups = [
            ('avatar-effect', 'profileAvatarEffect', ['none', 'halo', 'orbit', 'neon', 'stars', 'frost', 'flare', 'bloom', 'prism']),
            ('banner-effect', 'profileBannerEffect', ['none', 'glow', 'sakura', 'snow', 'stars', 'ember']),
            ('banner-sticker', 'profileBannerSticker', ['none', 'grin', 'heart_eyes', 'star_struck', 'cool', 'joy', 'fire', 'sparkles', 'hundred', 'rocket', 'rainbow', 'moon', 'sun', 'cherry', 'cat', 'party', 'ghost']),
        ]
        for prefix, field, values in groups:
            for value in values:
                self.ui.tap(Selector(id=f'{prefix}-{value}'), True)
                save = self.ui.locate(Selector(id='profile-save'), True)
                if save.attrib.get('enabled') != 'false':
                    self.save(field, value)
                self.preview(f'{prefix}-{value}')
        self.ui.back()

    def discard(self) -> None:
        self.editor()
        self.ui.fill(Selector(id='profile-status'), 'This change must be discarded', hide=True)
        self.ui.back()
        self.ui.wait(Selector(text='Есть несохранённые изменения'))
        self.ui.checkpoint('profile-dirty-leave-confirmation')
        self.ui.tap(Selector(text='Отмена'))
        self.ui.wait(Selector(id='profile-editor-screen'))
        self.ui.tap(Selector(description='Отменить изменения'), True)
        self.ui.absent(Selector(text='This change must be discarded'))
        self.ui.checkpoint('profile-draft-discarded')
        self.ui.tap(Selector(contains='Оформление'), True)
        self.ui.tap(Selector(description='Выбрать фото'), True)
        self.ui.back()
        self.ui.wait(Selector(id='profile-editor-screen'))
        self.ui.checkpoint('profile-image-picker-cancelled')
        self.ui.tap(Selector(description='Убрать баннер'), True)
        self.save('profileBanner', None)
        latest = [event for event in self.state()['captured'] if event['event'] == 'profile:update'][-1]['payload']
        assert latest['profileBannerEffect'] == latest['profileBannerSticker'] == 'none'
        self.preview('profile-banner-removal-clears-decoration')
        self.ui.tap(Selector(description='Убрать аватар'), True)
        self.save('avatar', None)
        self.preview('profile-avatar-removed')
        self.ui.back()

    def plans(self) -> None:
        self.api('/__test/events', {'action': 'plan', 'planSlug': 'free'})
        self.home('profile')
        self.ui.wait(Selector(text='Free'))
        self.ui.checkpoint('free-plan-live-update')
        self.ui.tap(Selector(id='edit-profile'), True)
        self.ui.tap(Selector(contains='Оформление'), True)
        self.ui.tap(Selector(id='avatar-effect-neon'), True)
        self.ui.wait(Selector(id='plan-screen'))
        self.ui.checkpoint('locked-avatar-effect-opens-plan')
        self.ui.back()
        self.ui.tap(Selector(contains='Оформление'), True)
        self.ui.tap(Selector(description='Баннер в расширенном плане'), True)
        self.ui.wait(Selector(id='plan-screen'))
        self.ui.checkpoint('locked-banner-opens-plan')
        self.home('profile')
        self.api('/__test/events', {'action': 'plan', 'planSlug': 'medium'})
        self.ui.wait(Selector(text='Medium'))
        self.ui.tap(Selector(id='edit-profile'), True)
        self.ui.tap(Selector(contains='Оформление'), True)
        self.ui.tap(Selector(id='banner-effect-sakura'), True)
        self.ui.wait(Selector(id='plan-screen'))
        self.ui.checkpoint('medium-locks-premium-banner-effects')
        self.home('profile')
        self.api('/__test/events', {'action': 'plan', 'planSlug': 'pro'})
        self.ui.wait(Selector(text='Pro'))
        self.ui.checkpoint('pro-plan-restored')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--adb', default=UI.DEFAULT_ADB)
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--fixture', default='http://127.0.0.1:1502')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--groups', default='decorations,discard,plans')
    args = parser.parse_args()
    ui = UI.AndroidUI(args.adb, args.serial, args.output, 'com.playtimemobile')
    suite = ProfileCorners(ui, args.fixture)
    try:
        ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            tree = ui.tree()
            if any(ui.find(Selector(id=identifier), tree) is not None for identifier in [
                'bottom-navigation', 'profile-editor-screen', 'settings-screen', 'chat-screen',
            ]):
                break
            time.sleep(0.3)
        else:
            raise AssertionError('Android app did not finish starting')
        for group in args.groups.split(','):
            suite.run_group(group)
    except Exception as error:
        print(f'FAILED: {error}', file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
