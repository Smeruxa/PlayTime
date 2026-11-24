#!/usr/bin/env python3
"""Actual native A1 + guest web B + normal-login web A2 personal-call handoff."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import urllib.request

spec = importlib.util.spec_from_file_location('native_calls', Path(__file__).with_name('run-calls.py'))
calls = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = calls
spec.loader.exec_module(calls)
Selector = calls.Selector


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--serial', default='emulator-5556')
    args = parser.parse_args()
    ui = calls.UI.AndroidUI(calls.UI.DEFAULT_ADB, args.serial, args.output, 'com.playtimemobile')
    ui.output.chmod(0o700)
    suite = calls.CallSuite(ui, 'http://127.0.0.1:1516', 'http://127.0.0.1:1517')
    report = {'variant': 'debug native20 + Metro, actual guest web B and normal-login web A2, isolated real backend/PG/Redis/TURN',
              'snapshots': [], 'sourceSha256': {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in [
                  Path('mobile/src/features/calls/CallController.ts'), Path('mobile/src/features/calls/NativeVoiceMesh.ts')
              ]}}

    def control(path: str = '/status') -> dict:
        with urllib.request.urlopen('http://127.0.0.1:1517' + path, timeout=60) as response:
            return json.load(response)

    def audio(state: dict) -> int:
        return sum(row.get('packets', 0) for pc in state['connections'] if pc['connection'] == 'connected'
                   for row in pc['inbound'] if row['kind'] == 'audio')

    def video(state: dict) -> bool:
        return any(row['visible'] and row['width'] > 0 and not row['paused'] and row['readyState'] >= 2
                   for row in state['videos']) and any(row.get('frames', 0) > 5
                   for pc in state['connections'] for row in pc['inbound'] if row['kind'] == 'video')

    def wait_for(predicate, label: str) -> dict:
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            state = control()
            if predicate(state):
                return state
            time.sleep(0.4)
        raise AssertionError('Timed out: ' + label)

    def capture(name: str) -> dict:
        state = control()
        services = ui.run('shell', 'dumpsys', 'activity', 'services', ui.package)
        state['nativeCallAudioService'] = 'CallAudioService' in services
        state['nativeProjection'] = ui.run('shell', 'dumpsys', 'media_projection')
        report['snapshots'].append({'name': name, 'state': state})
        ui.checkpoint(name)
        for suffix, route in [('guest', '/screenshot'), ('second-device', '/owner-screenshot')]:
            if suffix == 'second-device' and not state['secondDevice']:
                continue
            with urllib.request.urlopen('http://127.0.0.1:1517' + route, timeout=15) as response:
                (ui.output / (name + '-' + suffix + '.png')).write_bytes(response.read())
        return state

    def owner(state: dict) -> dict:
        return next(row for row in state['backendCall']['owners'] if row['userId'] == 1)

    try:
        package = ui.run('shell', 'dumpsys', 'package', ui.package)
        report['installedVersion'] = re.search(r'versionName=(\S+)', package).group(1)
        assert report['installedVersion'] == json.loads((Path(__file__).resolve().parents[1] / 'package.json').read_text())['version']
        assert 'DEBUGGABLE' in package, 'This runner requires the isolated debug APK'
        ui.run('shell', 'am', 'force-stop', ui.package)
        ui.run('shell', 'pm', 'clear', ui.package)
        ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
        ui.wait(Selector(id='auth-screen'), 40)
        suite.login()
        suite.home('chats')
        ui.wait(Selector(id='chat-BrowserQA'), 30)
        ui.tap(Selector(id='chat-BrowserQA'))
        ui.tap(Selector(id='chat-call'))
        suite.microphone()
        control('/answer')
        ui.wait(Selector(id='call-screen'))
        wait_for(lambda state: audio(state) > 20, 'initial native audio')
        suite.screen_consent()
        wait_for(video, 'initial native screen in guest web')
        initial = capture('phone-a1-owns-audio-screen')
        initial_owner = owner(initial)
        assert initial['nativeCallAudioService']
        assert initial['captureRequests'] == 1

        control('/open-owner')
        time.sleep(1)
        passive = capture('web-a2-opens-passively')
        assert passive['secondDevice']['passiveCallVisible']
        assert passive['secondDevice']['captureRequests'] == 0
        assert passive['secondDevice']['connections'] == []
        assert owner(passive) == initial_owner
        assert passive['nativeCallAudioService']
        assert video(passive)

        control('/claim-owner')
        wait_for(lambda state: state['secondDevice'] and audio(state) > 20 and audio(state['secondDevice']) > 20,
                 'web A2 and guest audio after claim')
        ui.wait(Selector(id='call-ongoing-elsewhere'), 30)
        ui.absent(Selector(id='call-screen'))
        moved = capture('web-a2-claimed-phone-local-media-stopped')
        assert not moved['nativeCallAudioService']
        assert moved['videos'] == []
        assert moved['captureRequests'] == 1, 'Unchanged guest microphone was reacquired'
        assert moved['secondDevice']['captureRequests'] == 1
        assert owner(moved)['ownershipRevision'] > initial_owner['ownershipRevision']
        assert owner(moved)['socketId'] != initial_owner['socketId']
        assert moved['backendCall']['roomId'] == initial['backendCall']['roomId']

        ui.tap(Selector(id='call-claim'))
        ui.wait(Selector(id='call-screen'), 30)
        wait_for(lambda state: audio(state) > 20 and state['secondDevice']['passiveCallVisible'] and
                 all(row['state'] == 'ended' for row in state['secondDevice']['localAudioTracks']),
                 'phone reclaims and old web microphone ends')
        reclaimed = capture('phone-a1-reclaims-same-global-call')
        assert owner(reclaimed)['socketId'] == initial_owner['socketId']
        assert owner(reclaimed)['ownershipRevision'] > owner(moved)['ownershipRevision']
        assert reclaimed['captureRequests'] == 1
        assert reclaimed['nativeCallAudioService']
        suite.screen_consent()
        wait_for(video, 'native screen works after round-trip ownership')
        capture('reclaimed-native-screen-visible-in-guest')
        ui.tap(Selector(id='call-share'))
        ui.wait(Selector(description='Показать экран'))
        ui.tap(Selector(id='call-end'))
        ui.wait_absent(Selector(id='call-screen'))
        wait_for(lambda state: state['backendCall'] is None, 'global call ends only by current owner')
        ended = capture('owned-global-call-ended')
        assert not ended['nativeCallAudioService']
        assert not ended['errors'], ended['errors']
        report['status'] = 'passed'
    except Exception as error:
        report.update(status='failed', error=str(error))
        capture('native-handoff-failure')
        if ui.find(Selector(id='call-end')) is not None:
            ui.tap(Selector(id='call-end'))
        raise
    finally:
        report['checkpoints'] = ui.checkpoints
        path = ui.output / 'report.json'
        path.write_text(json.dumps(report, ensure_ascii=False, indent=4))
        path.chmod(0o600)


if __name__ == '__main__':
    main()
