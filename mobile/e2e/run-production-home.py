#!/usr/bin/env python3
"""Read-only home acceptance with dedicated QA credentials supplied outside the repository."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import time

spec = importlib.util.spec_from_file_location('native_ui', Path(__file__).with_name('run-ui.py'))
ui_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = ui_module
spec.loader.exec_module(ui_module)
Selector = ui_module.Selector


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--credentials', type=Path, required=True)
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--expect-broken', action='store_true')
    args = parser.parse_args()
    credentials = json.loads(args.credentials.read_text())
    account = credentials['users'][0]
    peer = credentials['users'][1]['username']
    ui = ui_module.AndroidUI(ui_module.DEFAULT_ADB, 'emulator-5558', args.output, 'com.playtimemobile')
    report = {'fixture': credentials['fixture'], 'scope': 'dedicated production QA home only; no messages/calls/payments',
              'apk': str(args.apk.resolve()), 'apkSha256': hashlib.sha256(args.apk.read_bytes()).hexdigest(),
              'expectedBroken': args.expect_broken}

    def home(tab: str) -> None:
        for _ in range(5):
            if ui.find(Selector(id='tab-' + tab)) is not None:
                ui.tap(Selector(id='tab-' + tab))
                return
            ui.back()
        raise AssertionError('Bottom navigation missing')

    def loaded(stage: str) -> None:
        home('friends')
        ui.wait(Selector(contains='1 всего'), 35)
        ui.locate(Selector(text=peer), True)
        ui.checkpoint(stage + '-friend-loaded')
        home('profile')
        ui.wait(Selector(text='Pro'), 30)
        ui.tap(Selector(text='Pro'))
        ui.wait(Selector(id='plan-screen'))
        ui.wait(Selector(text='Участников в комнате'))
        ui.wait(Selector(text='25'))
        ui.absent(Selector(contains='Загружаем условия'))
        ui.checkpoint(stage + '-pro-limits-loaded')

    try:
        package = ui.run('shell', 'dumpsys', 'package', ui.package)
        assert 'DEBUGGABLE' not in package, 'Installed app is debuggable'
        report['installedVersion'] = re.search(r'versionName=(\S+)', package).group(1)
        installed_path = ui.run('shell', 'pm', 'path', ui.package).strip().removeprefix('package:')
        installed_hash = ui.run('shell', 'sha256sum', installed_path).split()[0]
        assert installed_hash == report['apkSha256'], 'Installed APK differs from candidate'
        report['installedApkSha256'] = installed_hash
        if ui.find(Selector(id='auth-screen')) is not None:
            ui.fill(Selector(id='auth-email'), account['email'])
            ui.fill(Selector(id='auth-password'), account['password'], hide=True)
            ui.tap(Selector(id='auth-submit'), True)
            ui.wait(Selector(id='bottom-navigation'), 45)
        if args.expect_broken:
            time.sleep(18)
            home('friends')
            ui.wait(Selector(contains='0 всего'))
            ui.absent(Selector(text=peer))
            ui.checkpoint('signed18-production-friends-empty')
            home('profile')
            ui.tap(Selector(contains='Ваш план и доступные возможности'))
            ui.wait(Selector(id='plan-screen'))
            ui.wait(Selector(contains='Загружаем условия'))
            ui.checkpoint('signed18-production-plan-stuck-loading')
            report['status'] = 'reproduced'
        else:
            loaded('signed' + report['installedVersion'] + '-startup')
            home('friends')
            pid = ui.run('shell', 'pidof', ui.package).strip()
            ui.run('shell', 'input', 'keyevent', '3')
            time.sleep(2)
            ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
            ui.wait(Selector(id='bottom-navigation'), 35)
            assert ui.run('shell', 'pidof', ui.package).strip() == pid
            loaded('signed' + report['installedVersion'] + '-background-return')
            ui.run('shell', 'am', 'force-stop', ui.package)
            ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
            ui.wait(Selector(id='bottom-navigation'), 45)
            ui.absent(Selector(id='auth-screen'))
            loaded('signed' + report['installedVersion'] + '-cold-reopen')
            report['status'] = 'passed'
    except Exception:
        report['status'] = 'failed'
        report['error'] = 'Acceptance failed; credentials omitted. Inspect non-auth UI evidence.'
        if ui.find(Selector(id='auth-screen')) is None:
            ui.checkpoint('production-home-failure')
        raise RuntimeError(report['error']) from None
    finally:
        report['checkpoints'] = ui.checkpoints
        (ui.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=4))


if __name__ == '__main__':
    main()
