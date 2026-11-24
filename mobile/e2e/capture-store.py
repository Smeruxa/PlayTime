#!/usr/bin/env python3
"""Capture the actual application viewport for RuStore, excluding measured Android bars."""
from __future__ import annotations

from datetime import datetime, timezone
import argparse
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('playtime_store_ui', Path(__file__).with_name('run-ui.py'))
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
Selector = module.Selector


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', default='emulator-5558')
    parser.add_argument('--fixture', default='http://127.0.0.1:1506')
    parser.add_argument('--output', type=Path, default=ROOT / 'mobile/e2e/artifacts/store-screens')
    args = parser.parse_args()
    ui = module.AndroidUI(
        module.DEFAULT_ADB,
        args.serial,
        args.output,
        'com.playtimemobile',
    )
    suite = module.Suite(ui, args.fixture)
    folder = ROOT / 'mobile/release/rustore/screenshots'
    folder.mkdir(parents=True, exist_ok=True)
    screenshots: list[dict[str, object]] = []
    original_size = ui.run('shell', 'wm', 'size')
    original_density = ui.run('shell', 'wm', 'density')
    original_policy = ui.run('shell', 'settings', 'get', 'global', 'policy_control').strip()
    original_font = ui.run('shell', 'settings', 'get', 'system', 'font_scale').strip()

    def capture(name: str, description: str) -> None:
        time.sleep(1)
        insets = ui.insets()
        top = max(insets['statusBars'][3], insets.get('displayCutout', (0, 0, 0, 0))[3])
        bottom = insets['navigationBars'][1]
        assert bottom - top == 1920, f'Unexpected application viewport: {top}..{bottom}'
        ui.checkpoint(name, {'viewport': [0, top, 1080, bottom]})
        result = ui.run(
            'shell', 'am', 'instrument', '-w', '-r',
            '-e', 'mode', 'capture', '-e', 'left', '0', '-e', 'top', str(top),
            '-e', 'width', '1080', '-e', 'height', '1920',
            'com.playtime.uidriver/.HierarchyInstrumentation',
        )
        assert 'error=' not in result, result
        image = ui.run(
            'exec-out', 'run-as', 'com.playtime.uidriver', 'cat',
            'cache/playtime-window.png', binary=True,
        )
        assert image[:8] == b'\x89PNG\r\n\x1a\n', 'Native capture did not return PNG bytes; update the test UI driver.'
        assert struct.unpack('>II', image[16:24]) == (1080, 1920), 'Native capture dimensions must remain 1080 × 1920.'
        destination = folder / (name + '.png')
        destination.write_bytes(image)
        screenshots.append({
            'file': 'screenshots/' + destination.name,
            'description': description,
            'source': str(Path(ui.checkpoints[-1]['screenshot']).relative_to(ROOT / 'mobile')),
            'captureBounds': [0, top, 1080, bottom],
            'device': 'Android API 36 emulator; 420 dpi; actual application viewport captured by native test driver',
            'processing': 'No scaling, retouching or generated UI. System bars excluded by measured capture bounds.',
            'capturedAt': datetime.now(timezone.utc).isoformat(),
        })

    try:
        ui.run('shell', 'settings', 'delete', 'global', 'policy_control')
        ui.run('shell', 'settings', 'put', 'system', 'font_scale', '1')
        ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '0')
        ui.run('shell', 'wm', 'size', '1080x2200')
        ui.run('shell', 'wm', 'density', '420')
        ui.run('shell', 'am', 'force-stop', ui.package)
        ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
        ui.wait(Selector(id='bottom-navigation'), 45)
        time.sleep(1)
        insets = ui.insets()
        top = max(insets['statusBars'][3], insets.get('displayCutout', (0, 0, 0, 0))[3])
        navigation_height = insets['navigationBars'][3] - insets['navigationBars'][1]
        display_height = 1920 + top + navigation_height
        ui.run('shell', 'wm', 'size', f'1080x{display_height}')
        ui.width, ui.height = 1080, display_height
        time.sleep(1)
        for _ in range(5):
            insets = ui.insets()
            top = max(insets['statusBars'][3], insets.get('displayCutout', (0, 0, 0, 0))[3])
            actual_height = insets['navigationBars'][1] - top
            if actual_height == 1920:
                break
            display_height += 1920 - actual_height
            ui.run('shell', 'wm', 'size', f'1080x{display_height}')
            ui.height = display_height
            time.sleep(0.5)
        suite.home('chats')
        ui.wait(Selector(id='chat-Nova'), 20)
        capture('01-conversations', 'Диалоги и комнаты в одном списке')
        ui.tap(Selector(id='chat-Nova'), True)
        ui.wait(Selector(id='message-input'))
        capture('02-chat', 'Зашифрованная переписка, ответы и реакции')
        suite.home('rooms')
        ui.tap(Selector(contains='Вечерний пати'), True)
        ui.wait(Selector(id='message-input'))
        capture('03-room', 'Переписка компании в комнате')
        suite.home('profile')
        ui.wait(Selector(id='edit-profile'))
        capture('04-profile', 'Профиль и управление аккаунтом')
        (folder.parent / 'screenshots.json').write_text(
            json.dumps(screenshots, ensure_ascii=False, indent=4) + '\n', encoding='utf8',
        )
    finally:
        size = re.search(r'Override size: (\d+x\d+)', original_size)
        density = re.search(r'Override density: (\d+)', original_density)
        ui.run('shell', 'wm', 'size', size.group(1) if size else 'reset')
        ui.run('shell', 'wm', 'density', density.group(1) if density else 'reset')
        ui.run('shell', 'settings', 'put', 'system', 'font_scale', original_font)
        if original_policy == 'null':
            ui.run('shell', 'settings', 'delete', 'global', 'policy_control')
        else:
            ui.run('shell', 'settings', 'put', 'global', 'policy_control', original_policy)
        (ui.output / 'report.json').write_text(
            json.dumps({'screenshots': screenshots, 'checkpoints': ui.checkpoints}, ensure_ascii=False, indent=4),
            encoding='utf8',
        )


if __name__ == '__main__':
    main()
