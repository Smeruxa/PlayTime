#!/usr/bin/env python3
"""Check the collapsed search, newest-first dialogs and accessible IME layouts."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import struct
import sys
import time

spec = importlib.util.spec_from_file_location('dialogs_ui', Path(__file__).with_name('run-ui.py'))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
Selector = module.Selector


def update_viewport(ui: module.AndroidUI) -> None:
    frame = ui.run('exec-out', 'screencap', '-p', binary=True)
    ui.width, ui.height = struct.unpack('>II', frame[16:24])


def check_search_keyboard(ui: module.AndroidUI) -> dict:
    deadline = time.monotonic() + 3
    while not ui.keyboard_visible() and time.monotonic() < deadline:
        time.sleep(0.1)
    assert ui.keyboard_visible(), 'Search must open the software keyboard'
    field = ui.bounds(ui.wait(Selector(id='conversation-search')))
    ime = ui.insets()['ime']
    assert field[3] <= ime[1], f'Search overlaps IME: {field} / {ime}'
    return {'inputBounds': field, 'ime': ime}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', default='emulator-5556')
    parser.add_argument('--fixture', default='http://127.0.0.1:1504')
    parser.add_argument('--output', type=Path, default=Path('mobile/e2e/artifacts/dialogs-refresh'))
    args = parser.parse_args()
    ui = module.AndroidUI(module.DEFAULT_ADB, args.serial, args.output, 'com.playtimemobile')
    suite = module.Suite(ui, args.fixture)
    report: dict[str, object] = {}
    original_font = ui.run('shell', 'settings', 'get', 'system', 'font_scale').strip()
    original_auto = ui.run('shell', 'settings', 'get', 'system', 'accelerometer_rotation').strip()
    original_rotation = ui.run('shell', 'settings', 'get', 'system', 'user_rotation').strip()
    try:
        ui.run('shell', 'am', 'force-stop', ui.package)
        ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
        ui.wait(Selector(id='bottom-navigation'), 45)
        suite.navigation()
        button = ui.bounds(ui.wait(Selector(id='conversation-search-toggle')))
        x, y = str((button[0] + button[2]) // 2), str((button[1] + button[3]) // 2)
        ui.run('shell', f'for i in 1 2 3 4 5 6; do input tap {x} {y}; done')
        time.sleep(0.8)
        ui.wait_absent(Selector(id='conversation-search'))
        assert not ui.keyboard_visible(), 'Closed search must not refocus after an interrupted animation'
        ui.checkpoint('search-rapid-toggle-closed')
        ui.tap(Selector(id='conversation-search-toggle'))
        ui.checkpoint('search-portrait-ime', check_search_keyboard(ui))
        ui.run('shell', 'settings', 'put', 'system', 'font_scale', '2')
        time.sleep(1)
        ui.checkpoint('search-large-font-ime', check_search_keyboard(ui))
        ui.hide_keyboard()
        ui.run('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
        ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '1')
        time.sleep(1)
        update_viewport(ui)
        ui.tap(Selector(id='conversation-search'))
        ui.checkpoint('search-landscape-large-font-ime', check_search_keyboard(ui))
        ui.tap(Selector(id='conversation-search-toggle'))
        ui.wait_absent(Selector(id='conversation-search'))
        ui.checkpoint('dialogs-landscape-large-font', ui.assert_safe('bottom-navigation'))
        report['status'] = 'passed'
    except Exception as error:
        report.update(status='failed', error=str(error))
        ui.checkpoint('failure')
        raise
    finally:
        ui.run('shell', 'settings', 'put', 'system', 'font_scale', original_font)
        ui.run('shell', 'settings', 'put', 'system', 'user_rotation', original_rotation)
        ui.run('shell', 'settings', 'put', 'system', 'accelerometer_rotation', original_auto)
        report['checkpoints'] = ui.checkpoints
        (ui.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=4) + '\n')


if __name__ == '__main__':
    main()
