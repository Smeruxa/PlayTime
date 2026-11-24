#!/usr/bin/env python3
"""Native six-digit emailed-code UI on the isolated deterministic protocol fixture."""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('auth_resume', Path(__file__).with_name('run-auth-resume.py'))
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--serial', default='emulator-5556')
    args = parser.parse_args()
    ui = module.UI.AndroidUI(module.UI.DEFAULT_ADB, args.serial, args.output, 'com.playtimemobile')
    ui.output.chmod(0o700)
    suite = module.AuthResumeSuite(ui, 'http://127.0.0.1:1516')
    report = {'variant': 'debug20 + Metro; deterministic local protocol fixture, no SMTP or external email'}
    try:
        ui.run('shell', 'am', 'force-stop', ui.package)
        ui.run('shell', 'pm', 'clear', ui.package)
        ui.run('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1')
        ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
        ui.wait(module.Selector(id='auth-screen'), 40)
        suite.register('OTP')
        ui.fill(module.Selector(id='auth-code'), '012345')
        field = ui.locate(module.Selector(id='auth-code'), True)
        assert field.get('text') == '012345'
        assert ui.keyboard_visible()
        ime_top = ui.insets()['ime'][1]
        assert ui.bounds(field)[3] <= ime_top, 'Code field overlaps keyboard'
        input_state = ui.run('shell', 'dumpsys', 'input_method')
        editor_type = re.search(r'inputType=0x([0-9a-f]+)', input_state)
        assert editor_type and int(editor_type.group(1), 16) & 0xf == 2, 'OTP keyboard is not numeric'
        assert ui.bounds(ui.locate(module.Selector(id='auth-submit'), True))[3] <= ime_top
        (ui.output / 'input-method.txt').write_text(input_state)
        report['code'] = {'length': 6, 'leadingZeroPreserved': True, 'numericInputClass': True, 'fieldBounds': ui.bounds(field), 'imeTop': ime_top}
        ui.checkpoint('six-digits-leading-zero-numeric-keypad', report['code'])
        ui.run('shell', 'input', 'text', '9')
        assert ui.locate(module.Selector(id='auth-code'), True).get('text') == '012345', 'Seventh digit accepted'
        report['maxLengthSix'] = True
        ui.hide_keyboard()
        ui.tap(module.Selector(id='auth-submit'), True)
        ui.wait(module.Selector(description='Перейти ко входу'))
        ui.checkpoint('six-digit-code-verifies')
        report['passed'] = True
    except Exception as error:
        report['passed'] = False
        report['error'] = str(error)
        ui.checkpoint('otp-failure')
        raise
    finally:
        path = ui.output / 'report.json'
        path.write_text(json.dumps(report, ensure_ascii=False, indent=4) + '\n')
        path.chmod(0o600)


if __name__ == '__main__':
    main()
