#!/usr/bin/env python3
"""Exercise continuous emoji virtualization through actual Android gestures."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import struct
import sys
import time

spec = importlib.util.spec_from_file_location('emoji_ui', Path(__file__).with_name('run-ui.py'))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
Selector = module.Selector


def update_viewport(ui: module.AndroidUI) -> None:
    frame = ui.run('exec-out', 'screencap', '-p', binary=True)
    ui.width, ui.height = struct.unpack('>II', frame[16:24])


def visible_emoji(ui: module.AndroidUI) -> list[str]:
    return [
        node.attrib['content-desc']
        for node in ui.tree().iter('node')
        if node.attrib.get('content-desc', '').startswith('Вставить ')
    ]


def fling(ui: module.AndroidUI, count: int = 1) -> None:
    left, top, right, bottom = ui.bounds(ui.wait(Selector(id='emoji-list')))
    x = str((left + right) // 2)
    for _ in range(count):
        ui.run('shell', 'input', 'swipe', x, str(bottom - 12), x, str(top + 12), '90')
    time.sleep(0.7)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', default='emulator-5558')
    parser.add_argument('--fixture', default='http://127.0.0.1:1506')
    parser.add_argument('--output', type=Path, default=Path('mobile/e2e/artifacts/emoji-virtual-scroll'))
    args = parser.parse_args()
    ui = module.AndroidUI(module.DEFAULT_ADB, args.serial, args.output, 'com.playtimemobile')
    suite = module.Suite(ui, args.fixture)
    report: dict[str, object] = {}
    original_font = ui.run('shell', 'settings', 'get', 'system', 'font_scale').strip()
    original_rotation = ui.run('shell', 'settings', 'get', 'system', 'user_rotation').strip()
    original_auto = ui.run('shell', 'settings', 'get', 'system', 'accelerometer_rotation').strip()
    try:
        ui.run('shell', 'am', 'force-stop', ui.package)
        ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
        ui.wait(Selector(id='bottom-navigation'), 45)
        suite.home('chats')
        ui.tap(Selector(id='chat-Nova'), True)
        ui.wait(Selector(id='message-input'))
        ui.tap(Selector(description='Эмодзи'))
        ui.wait(Selector(id='emoji-list'))
        initial = visible_emoji(ui)
        ui.checkpoint('initial-virtual-window', {'visibleGlyphs': len(initial)})
        fling(ui, 24)
        distant = visible_emoji(ui)
        assert distant and distant != initial, 'Fling must reach a different catalogue section'
        assert len(distant) < 150, 'The 901-glyph catalogue must remain virtualized'
        ui.checkpoint('fast-fling-distant-window', {'visibleGlyphs': len(distant)})
        selected = distant[len(distant) // 2]
        ui.tap(Selector(description=selected))
        ui.tap(Selector(description='Частые'))
        ui.wait(Selector(description=selected))
        ui.checkpoint('selected-emoji-in-frequent')
        ui.tap(Selector(description='Все'))
        ui.run('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
        ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '1')
        time.sleep(1)
        update_viewport(ui)
        fling(ui)
        assert visible_emoji(ui)
        ui.checkpoint('landscape-virtual-grid')
        ui.run('shell', 'settings', 'put', 'system', 'font_scale', '2')
        time.sleep(2)
        suite.home('chats')
        ui.tap(Selector(id='chat-Nova'), True)
        ui.tap(Selector(description='Эмодзи'))
        ui.wait(Selector(description='Закрыть эмодзи'))
        ui.checkpoint('landscape-large-font')
        ui.tap(Selector(description='Закрыть эмодзи'))
        field = ui.wait(Selector(id='message-input'))
        assert selected.removeprefix('Вставить ') in field.attrib['text']
        ui.fill(Selector(id='message-input'), '', hide=True)
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
        (ui.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=4))


if __name__ == '__main__':
    main()
