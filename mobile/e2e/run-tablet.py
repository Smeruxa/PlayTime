#!/usr/bin/env python3
"""Exercise chat, forms and rotation at tablet width, restoring emulator settings."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import sys
import time

spec = importlib.util.spec_from_file_location('tablet_layout', Path(__file__).with_name('run-layout.py'))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def main() -> None:
    ui = module.AndroidUI(module.module.DEFAULT_ADB, 'emulator-5558', Path('mobile/e2e/artifacts/tablet-layout'), 'com.playtimemobile')
    suite = module.Suite(ui, 'http://127.0.0.1:1506')
    size = ui.run('shell', 'wm', 'size')
    density = ui.run('shell', 'wm', 'density')
    font = ui.run('shell', 'settings', 'get', 'system', 'font_scale').strip()
    report: dict[str, object] = {'viewport': [1200, 1920], 'density': 240}
    try:
        ui.run('shell', 'wm', 'size', '1200x1920')
        ui.run('shell', 'wm', 'density', '240')
        ui.width, ui.height = 1200, 1920
        ui.run('shell', 'am', 'force-stop', ui.package)
        ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
        ui.wait(module.Selector(id='bottom-navigation'), 45)
        module.run_chat(ui, suite, [1, 2])
        module.run_forms(ui, suite, [2])
        module.run_landscape(ui, suite, [2])
        report['status'] = 'passed'
    except Exception as error:
        report.update(status='failed', error=str(error))
        ui.checkpoint('failure')
        raise
    finally:
        previous_size = re.search(r'Override size: (\d+x\d+)', size)
        previous_density = re.search(r'Override density: (\d+)', density)
        ui.run('shell', 'wm', 'size', previous_size.group(1) if previous_size else 'reset')
        ui.run('shell', 'wm', 'density', previous_density.group(1) if previous_density else 'reset')
        ui.run('shell', 'settings', 'put', 'system', 'font_scale', font)
        ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '0')
        report['checkpoints'] = ui.checkpoints
        (ui.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=4))


if __name__ == '__main__':
    main()
