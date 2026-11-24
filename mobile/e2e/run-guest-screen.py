#!/usr/bin/env python3
"""Actual Android call and screen capture to the full guest web application."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
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
    parser.add_argument('--serial', default='emulator-5558')
    parser.add_argument('--fresh', action='store_true')
    args = parser.parse_args()
    ui = calls.UI.AndroidUI(calls.UI.DEFAULT_ADB, args.serial, args.output, 'com.playtimemobile')
    ui.output.chmod(0o700)
    suite = calls.CallSuite(ui, 'http://127.0.0.1:1516', 'http://127.0.0.1:1517')
    report = {'variant': 'debug native APK + Metro; actual full guest web app; isolated real backend/PG/Redis/TURN',
              'snapshots': [], 'sourceSha256': {
                  str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in [
                      Path('mobile/src/features/calls/NativeVoiceMesh.ts'), Path('mobile/src/features/calls/CallController.ts')
                  ] if path.exists()
              }}

    def capture(name: str) -> dict:
        state = suite.peer_api()
        report['snapshots'].append({'name': name, 'state': state})
        ui.checkpoint(name)
        (ui.output / (name + '-browser.png')).write_bytes(
            urllib.request.urlopen('http://127.0.0.1:1517/screenshot', timeout=15).read())
        return state

    def audio_packets(state: dict) -> int:
        return sum(row.get('packets', 0) for pc in state['connections'] for row in pc['inbound'] if row['kind'] == 'audio')

    def screen_frames(state: dict) -> int:
        return sum(row.get('frames', 0) for pc in state['connections'] for row in pc['inbound'] if row['kind'] == 'video')

    def wait_media(video: bool = False, after_frames: int = 0) -> dict:
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            state = suite.peer_api()
            if audio_packets(state) > 10 and (not video or (
                screen_frames(state) > after_frames + 5 and any(
                    row['visible'] and row['width'] > 0 and row['height'] > 0
                    and not row['paused'] and row['readyState'] >= 2 for row in state['videos']))):
                return state
            time.sleep(0.4)
        capture('media-timeout')
        raise AssertionError('Actual guest web did not receive/play the required media')

    try:
        if args.fresh:
            ui.run('shell', 'am', 'force-stop', ui.package)
            ui.run('shell', 'pm', 'clear', ui.package)
            ui.run('shell', 'am', 'start', '-n', ui.package + '/.MainActivity')
            ui.wait(Selector(id='auth-screen'), 40)
        suite.login()
        suite.home('chats')
        ui.wait(Selector(id='chat-BrowserQA'), 40)
        ui.tap(Selector(id='chat-BrowserQA'))
        ui.tap(Selector(id='chat-call'))
        suite.microphone()
        suite.peer_api('/answer')
        ui.wait(Selector(id='call-screen'))
        wait_media()
        capture('personal-call-audio-established')
        suite.screen_consent()
        initial = wait_media(video=True)
        capture('android-screen-visible-in-actual-guest-web')
        ui.tap(Selector(id='call-share'))
        ui.wait(Selector(description='Показать экран'))
        time.sleep(2)
        stopped = capture('android-screen-stopped-audio-retained')
        assert audio_packets(stopped) > audio_packets(initial), 'Microphone RTP stopped with screen'
        assert not any(row['visible'] and row['width'] > 0 for row in stopped['videos']), 'Stopped screen remains visible'
        suite.screen_consent()
        restarted = wait_media(video=True)
        capture('android-screen-restarted-in-guest-web')
        assert audio_packets(restarted) > audio_packets(stopped), 'Microphone RTP stopped on screen restart'
        ui.tap(Selector(id='call-share'))
        ui.wait(Selector(description='Показать экран'))
        ui.tap(Selector(id='call-end'))
        ui.wait_absent(Selector(id='call-screen'))
        capture('call-ended')
        report['status'] = 'passed'
    except Exception as error:
        report.update(status='failed', error=str(error))
        capture('guest-screen-failure')
        if ui.find(Selector(id='call-end')) is not None:
            ui.tap(Selector(id='call-end'))
            ui.wait_absent(Selector(id='call-screen'))
        raise
    finally:
        report['checkpoints'] = ui.checkpoints
        (ui.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=4))
        (ui.output / 'report.json').chmod(0o600)


if __name__ == '__main__':
    main()
