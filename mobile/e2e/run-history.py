#!/usr/bin/env python3
"""Verify older-page navigation through native pinned-message and reply controls."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('history_ui', Path(__file__).with_name('run-ui.py'))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
Selector = module.Selector


def main() -> None:
    ui = module.AndroidUI(module.DEFAULT_ADB, 'emulator-5558', ROOT / 'mobile/e2e/artifacts/history-pagination', 'com.playtimemobile')
    suite = module.Suite(ui, 'http://127.0.0.1:1506')
    ui.run('shell', 'am', 'force-stop', ui.package)
    ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
    ui.wait(Selector(id='bottom-navigation'), 45)
    suite.home('chats')
    subprocess.run(['node', str(Path(__file__).with_name('seed-history.cjs'))], check=True)
    seed = json.loads((ROOT / 'mobile/e2e/artifacts/history-seed.json').read_text())
    report: dict[str, object] = {'seed': seed}
    try:
        ui.run('shell', 'am', 'force-stop', ui.package)
        ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
        ui.wait(Selector(id='bottom-navigation'), 45)
        suite.home('rooms')
        ui.tap(Selector(contains='Вечерний пати'), True)
        ui.wait(Selector(id=f"message-{seed['latest']}"))
        ui.checkpoint('latest-page-and-reply')
        ui.absent(Selector(id=f"message-{seed['first']}"))
        ui.tap(Selector(contains='Закреплённое сообщение'))
        ui.wait(Selector(id=f"message-{seed['first']}"), 30)
        ui.wait(Selector(id='unread-messages-divider'))
        ui.checkpoint('old-pin-loads-page-and-unread-boundary')
        suite.home('rooms')
        ui.tap(Selector(contains='Вечерний пати'), True)
        ui.wait(Selector(id=f"message-reply-{seed['latest']}"))
        ui.tap(Selector(id=f"message-reply-{seed['latest']}"))
        ui.wait(Selector(id=f"message-{seed['first']}"), 30)
        ui.checkpoint('reply-loads-older-original')
        suite.home('rooms')
        ui.tap(Selector(contains='Вечерний пати'), True)
        ui.wait(Selector(id=f"message-{seed['latest']}"))
        for _ in range(30):
            if ui.find(Selector(description='Предыдущие сообщения')) is not None:
                break
            left, top, right, bottom = ui.bounds(ui.wait(Selector(id='message-list')))
            x = str((left + right) // 2)
            ui.run('shell', 'input', 'swipe', x, str(top + 16), x, str(bottom - 16), '150')
            time.sleep(0.25)
        ui.wait(Selector(description='Предыдущие сообщения'))
        visible = [node.attrib['resource-id'] for node in ui.tree().iter('node') if node.attrib.get('resource-id', '').startswith('message-') and node.attrib.get('resource-id', '').removeprefix('message-').isdigit()]
        ui.tap(Selector(description='Предыдущие сообщения'))
        time.sleep(1)
        assert any(ui.find(Selector(id=identifier)) is not None for identifier in visible), 'Prepending a page displaced the entire viewport'
        ui.checkpoint('manual-pagination-preserves-visible-messages')
        report['status'] = 'passed'
    except Exception as error:
        report.update(status='failed', error=str(error))
        ui.checkpoint('failure')
        raise
    finally:
        report['checkpoints'] = ui.checkpoints
        (ui.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=4))


if __name__ == '__main__':
    main()
