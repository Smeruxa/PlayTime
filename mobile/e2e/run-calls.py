#!/usr/bin/env python3
"""Exercise native call UI against a real Electron WebRTC peer, retaining RTP evidence."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys
import struct
import time
import urllib.request

SOURCE = Path(__file__).with_name('run-ui.py')
SPEC = importlib.util.spec_from_file_location('playtime_ui_e2e', SOURCE)
assert SPEC and SPEC.loader
UI = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = UI
SPEC.loader.exec_module(UI)
Selector = UI.Selector


class CallSuite(UI.Suite):
    def __init__(self, ui, fixture: str, peer: str, secondary_peer: str | None = None):
        super().__init__(ui, fixture)
        self.peer = peer.rstrip('/')
        self.secondary_peer = secondary_peer

    def peer_api(self, path: str = '/status', body: dict | None = None, base: str | None = None) -> dict:
        request = urllib.request.Request(
            (base or self.peer) + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type': 'application/json'},
            method='GET' if body is None else 'POST',
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)

    def ensure_call(self) -> None:
        if not self.peer_api()['call']:
            self.peer_api('/call', {'username': 'Mika'})
            self.ui.wait(Selector(id='call-accept'))
            self.ui.tap(Selector(id='call-accept'))
            self.microphone()
        self.connected()

    def set_microphone_muted(self, muted: bool) -> None:
        desired = Selector(description='Включить микрофон' if muted else 'Выключить микрофон')
        if self.ui.find(desired) is None:
            self.ui.tap(Selector(id='call-mute'))
        self.ui.wait(desired)

    def screen_consent(self, system_audio: bool = False, cancel: bool = False) -> None:
        self.ui.tap(Selector(id='call-share'))
        self.ui.wait(Selector(id='android:id/button2'))
        self.ui.tap(Selector(id='android:id/button1' if system_audio else 'android:id/button2'))
        self.ui.wait(Selector(id='com.android.systemui:id/screen_share_mode_options'))
        if cancel:
            self.ui.tap(Selector(id='android:id/button2'))
            return
        self.ui.tap(Selector(id='com.android.systemui:id/screen_share_mode_options'))
        self.ui.tap(Selector(text='Share entire screen'))
        self.ui.checkpoint('android-entire-screen-consent')
        self.ui.tap(Selector(id='android:id/button1'))

    def local_screen(self) -> None:
        self.ensure_call()
        self.screen_consent(cancel=True)
        self.ui.wait(Selector(description='Показать экран'))
        self.ui.checkpoint('projection-cancel-keeps-call', {'rtp': self.connected()})
        self.screen_consent()
        self.ui.checkpoint('android-screen-sender', {'rtp': self.connected(video=True)})
        with urllib.request.urlopen(self.peer + '/screenshot', timeout=10) as response:
            (self.ui.output / 'android-screen-received-electron.png').write_bytes(response.read())
        self.ui.tap(Selector(id='call-share'))
        self.ui.wait(Selector(description='Показать экран'))
        self.ui.checkpoint('android-screen-stopped', {'rtp': self.connected()})
        self.ui.tap(Selector(id='call-end'))

    def screen_signal(self, expected_tone: bool, timeout: float = 25) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status = self.peer_api()
            signals = [
                signal for peer in status['connections']
                for signal in peer.get('audioSignals', []) if signal['screen']
            ]
            if expected_tone:
                matched = any(abs(signal['peakHz'] - 880) < 30 and signal['rms'] > 0.005 for signal in signals)
            else:
                matched = bool(signals) and all(signal['rms'] < 0.002 for signal in signals)
            if matched:
                return status
            time.sleep(0.4)
        raise AssertionError(f'External 880 Hz capture expectation={expected_tone} failed: {status}')

    def received_screen_quality(self, maximum_side: int, maximum_fps: int, minimum_side: int = 1) -> dict:
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            status = self.peer_api()
            video = [
                stat for peer in status['connections'] for stat in peer['media']
                if stat['type'] == 'inbound-rtp' and stat['kind'] == 'video'
            ]
            if any(
                minimum_side <= max(stat.get('frameWidth', 0), stat.get('frameHeight', 0)) <= maximum_side
                and 0 < stat.get('framesPerSecond', 0) <= maximum_fps + 1
                for stat in video
            ):
                return status
            time.sleep(0.5)
        raise AssertionError(f'Screen plan limits were not applied: {status}')

    def screen_limits(self) -> None:
        self.ensure_call()
        self.screen_consent()
        self.ui.checkpoint('screen-pro-quality', {'rtp': self.received_screen_quality(1920, 35, 1200)})
        self.api('/__test/events', {'action': 'plan', 'planSlug': 'free'})
        self.ui.checkpoint('screen-free-live-downgrade', {'rtp': self.received_screen_quality(854, 10, 700)})
        self.api('/__test/events', {'action': 'plan', 'planSlug': 'pro'})
        self.ui.checkpoint('screen-pro-live-upgrade', {'rtp': self.received_screen_quality(1920, 35, 1200)})
        self.ui.tap(Selector(id='call-share'))
        self.ui.wait(Selector(description='Показать экран'))
        self.ui.tap(Selector(id='call-end'))

    def system_audio(self) -> None:
        self.ensure_call()
        process_id = self.ui.run('shell', 'pidof', self.ui.package).strip()
        started_capture = self.ui.find(Selector(description='Остановить экран')) is None
        if started_capture:
            self.screen_consent(system_audio=True)
        self.connected(video=True)
        self.ui.wait(Selector(contains='Ваш экран · звук приложений'), 30)
        self.ui.checkpoint('system-audio-capture-started', {'rtp': self.peer_api(), 'startedNewCapture': started_capture})
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtime.audiofixture/.MainActivity')
        self.ui.tap(Selector(text='Play external 880 Hz tone'))
        self.ui.checkpoint('external-880hz-playing')
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
        time.sleep(0.6)
        tone = self.screen_signal(True)
        self.ui.checkpoint('external-880hz-received', {'rtp': tone})
        with urllib.request.urlopen(self.peer + '/screenshot', timeout=10) as response:
            (self.ui.output / 'system-audio-screen-received-electron.png').write_bytes(response.read())
        self.set_microphone_muted(True)
        time.sleep(12)
        self.ui.checkpoint('microphone-muted-system-audio-retained', {'rtp': self.screen_signal(True)})
        assert self.ui.run('shell', 'pidof', self.ui.package).strip(), 'Native app died while sharing audio'
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtime.audiofixture/.MainActivity')
        self.ui.tap(Selector(text='Stop tone'))
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
        time.sleep(0.6)
        self.ui.checkpoint('external-tone-stop-produces-silence', {'rtp': self.screen_signal(False)})
        self.set_microphone_muted(False)
        self.ui.tap(Selector(id='call-share'))
        self.ui.wait(Selector(description='Показать экран'))
        self.ui.checkpoint('system-audio-stopped-call-retained', {'rtp': self.connected()})
        self.ui.tap(Selector(id='call-end'))
        self.ui.wait_absent(Selector(id='call-screen'))
        assert self.ui.run('shell', 'pidof', self.ui.package).strip() == process_id, 'Native process changed during capture cleanup'
        assert self.peer_api()['call'] is None, 'Fixture call remained active after hangup'
        services = self.ui.run('shell', 'dumpsys', 'activity', 'services', self.ui.package)
        (self.ui.output / 'services-after-system-audio.txt').write_text(services)
        assert 'ServiceRecord' not in services, 'Microphone/projection foreground service remained active'
        self.ui.checkpoint('system-audio-call-ended', {'nativePid': process_id})

    def active_share_end(self) -> None:
        self.ensure_call()
        process_id = self.ui.run('shell', 'pidof', self.ui.package).strip()
        self.screen_consent(system_audio=True)
        self.connected(video=True)
        self.ui.wait(Selector(contains='Ваш экран · звук приложений'), 30)
        self.ui.checkpoint('active-system-audio-before-hangup', {'rtp': self.peer_api()})
        self.ui.tap(Selector(id='call-end'))
        self.ui.wait_absent(Selector(id='call-screen'))
        time.sleep(1)
        assert self.ui.run('shell', 'pidof', self.ui.package).strip() == process_id, 'Native process died on active-share hangup'
        assert self.peer_api()['call'] is None
        services = self.ui.run('shell', 'dumpsys', 'activity', 'services', self.ui.package)
        assert 'ServiceRecord' not in services, services
        self.ui.checkpoint('active-share-hangup-cleanup', {'nativePid': process_id, 'services': services})

    def audio_settings(self) -> None:
        self.home('profile')
        self.ui.tap(Selector(description='Настройки'))
        self.ui.tap(Selector(id='microphone-test'))
        self.ui.wait(Selector(id='microphone-level'))
        self.ui.checkpoint('settings-recording-live-level')
        self.ui.tap(Selector(id='microphone-test-cancel'))
        self.ui.wait_absent(Selector(id='microphone-level'))
        self.ui.checkpoint('settings-recording-cancelled')
        self.ui.tap(Selector(id='microphone-test'))
        self.ui.wait(Selector(id='microphone-level'))
        time.sleep(4)
        self.ui.tap(Selector(id='microphone-test'))
        self.ui.wait(Selector(text='Запись воспроизводится.'))
        self.ui.checkpoint('settings-recorded-audio-playing')
        self.ui.tap(Selector(id='microphone-test-cancel'))
        self.ui.wait_absent(Selector(text='Запись воспроизводится.'))
        self.ui.tap(Selector(id='microphone-test'))
        self.ui.wait(Selector(id='microphone-level'))
        self.ui.run('shell', 'input', 'keyevent', '3')
        time.sleep(0.6)
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
        self.ui.wait(Selector(contains='Запись прервана'))
        self.ui.wait_absent(Selector(id='microphone-level'))
        self.ui.checkpoint('settings-background-cancels-recording')
        self.ui.tap(Selector(id='microphone-test'))
        self.ui.wait(Selector(id='microphone-level'))
        self.ui.back()
        self.ui.tap(Selector(description='Настройки'))
        self.ui.wait_absent(Selector(id='microphone-level'))
        self.ui.checkpoint('settings-exit-cleans-recording')
        self.home('chats')
        self.ensure_call()
        self.ui.tap(Selector(id='call-minimize'))
        self.home('profile')
        self.ui.tap(Selector(description='Настройки'))
        button = self.ui.wait(Selector(id='microphone-test'))
        assert button.attrib.get('enabled') == 'false', 'Microphone test remained enabled during call'
        self.ui.wait(Selector(contains='Проверка доступна после завершения звонка'))
        self.ui.checkpoint('settings-microphone-disabled-during-call', {'rtp': self.connected()})
        self.ui.tap(Selector(id='active-call-bar'))
        self.ui.tap(Selector(id='call-end'))

    def audio_routes(self) -> None:
        self.ensure_call()
        self.ui.tap(Selector(id='call-volume'))
        self.ui.tap(Selector(id='call-audio-routes'), True)
        deny = Selector(id='com.android.permissioncontroller:id/permission_deny_button')
        if self.ui.find(deny) is not None:
            self.ui.checkpoint('bluetooth-permission-request')
            self.ui.tap(deny)
            self.ui.wait(Selector(contains='Bluetooth недоступен без разрешения'))
        self.ui.wait(Selector(text='Динамик'))
        self.ui.checkpoint('basic-audio-routes-available')
        self.ui.tap(Selector(text='Динамик'))
        self.ui.wait(Selector(text='Выбрано: Динамик'))
        self.ui.checkpoint('speaker-route-selected')
        self.ui.tap(Selector(id='call-audio-routes'), True)
        deny_permanently = Selector(id='com.android.permissioncontroller:id/permission_deny_and_dont_ask_again_button')
        if self.ui.find(deny_permanently) is not None:
            self.ui.tap(deny_permanently)
            self.ui.wait(Selector(text='Открыть настройки Bluetooth'))
            self.ui.checkpoint('bluetooth-permanent-denial-settings')
        if self.ui.find(Selector(text='Телефон')) is not None:
            self.ui.tap(Selector(text='Телефон'))
            self.ui.wait(Selector(text='Выбрано: Телефон'))
            self.ui.checkpoint('earpiece-route-selected')
        self.ui.tap(Selector(id='call-volume-done'))
        self.ui.tap(Selector(id='call-end'))

    def call_layout(self) -> None:
        self.ui.run('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
        self.ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '0')
        time.sleep(1)
        self.ensure_call()
        original_size = (self.ui.width, self.ui.height)
        process_id = self.ui.run('shell', 'pidof', self.ui.package).strip()
        before = self.connected()
        try:
            self.ui.run('shell', 'settings', 'put', 'system', 'font_scale', '2.0')
            self.ui.run('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
            for orientation, name in [(0, 'portrait'), (1, 'landscape')]:
                self.ui.run('shell', 'settings', 'put', 'system', 'user_rotation', str(orientation))
                time.sleep(1)
                screenshot = self.ui.run('exec-out', 'screencap', '-p', binary=True)
                self.ui.width, self.ui.height = struct.unpack('>II', screenshot[16:24])
                self.ui.wait(Selector(contains='В звонке'), 30)
                tree = self.ui.tree()
                insets = self.ui.insets()
                bounds = {}
                for identifier in ['call-end', 'call-mute', 'call-minimize']:
                    node = self.ui.find(Selector(id=identifier), tree)
                    assert node is not None
                    box = self.ui.bounds(node)
                    assert 0 <= box[0] < box[2] <= self.ui.width
                    assert 0 <= box[1] < box[3] <= self.ui.height
                    for kind in ['statusBars', 'navigationBars', 'displayCutout']:
                        inset = insets.get(kind)
                        if inset:
                            intersects = max(box[0], inset[0]) < min(box[2], inset[2]) and max(box[1], inset[1]) < min(box[3], inset[3])
                            assert not intersects, f'{identifier} overlaps {kind}: {box} / {inset}'
                    bounds[identifier] = box
                if name == 'portrait':
                    assert bounds['call-end'][1] >= bounds['call-mute'][3], 'Large-font portrait toolbar did not update to two rows'
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    after = self.connected()
                    before_received = sum(stat.get('bytesReceived', 0) for peer in before['connections'] for stat in peer['media'] if stat['type'] == 'inbound-rtp' and stat['kind'] == 'audio')
                    after_received = sum(stat.get('bytesReceived', 0) for peer in after['connections'] for stat in peer['media'] if stat['type'] == 'inbound-rtp' and stat['kind'] == 'audio')
                    before_sent = sum(stat.get('bytesSent', 0) for peer in before['connections'] for stat in peer['media'] if stat['type'] == 'outbound-rtp' and stat['kind'] == 'audio')
                    after_sent = sum(stat.get('bytesSent', 0) for peer in after['connections'] for stat in peer['media'] if stat['type'] == 'outbound-rtp' and stat['kind'] == 'audio')
                    if after_received > before_received and after_sent > before_sent:
                        break
                    time.sleep(0.3)
                else:
                    raise AssertionError('Voice RTP stopped after font scale or rotation change')
                assert self.ui.run('shell', 'pidof', self.ui.package).strip() == process_id
                self.ui.checkpoint('call-font200-' + name, {'systemInsets': insets, 'bounds': bounds, 'rtp': after, 'nativePid': process_id, 'audioBytes': {'receivedBefore': before_received, 'receivedAfter': after_received, 'sentBefore': before_sent, 'sentAfter': after_sent}})
                before = after
                if name == 'landscape':
                    for _ in range(3):
                        self.ui.run('shell', 'input', 'swipe', str(self.ui.width // 2), str(bounds['call-end'][1] - 70), str(self.ui.width // 2), str(bounds['call-minimize'][3] + 25), '350')
                    peer_id = self.peer_api()['userId']
                    self.ui.tap(Selector(id=f'call-participant-{peer_id}'))
                    self.ui.locate(Selector(id='call-volume-done'), True)
                    self.ui.checkpoint('call-font200-participant-volume')
                    self.ui.tap(Selector(id='call-volume-done'))
                self.set_microphone_muted(True)
                self.set_microphone_muted(False)
        finally:
            self.ui.run('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
            self.ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '0')
            self.ui.width, self.ui.height = original_size
            time.sleep(0.5)
        self.connected()
        end = self.ui.bounds(self.ui.wait(Selector(id='call-end')))
        mute = self.ui.bounds(self.ui.wait(Selector(id='call-mute')))
        assert end[1] == mute[1], 'Toolbar did not return to one row at 100% font scale'
        self.ui.checkpoint('call-font100-restored-toolbar', {'bounds': {'call-end': end, 'call-mute': mute}})
        self.ui.tap(Selector(id='call-end'))
        self.ui.wait_absent(Selector(id='call-screen'))
        assert self.peer_api()['call'] is None
        services = self.ui.run('shell', 'dumpsys', 'activity', 'services', self.ui.package)
        assert 'ServiceRecord' not in services, services
        self.ui.checkpoint('font200-call-ended-cleanly', {'nativePid': process_id, 'services': services})

    def mute_persistence(self) -> None:
        self.ensure_call()
        self.set_microphone_muted(True)
        self.ui.tap(Selector(id='call-end'))
        self.ui.wait_absent(Selector(id='call-screen'))
        self.ui.run('shell', 'am', 'force-stop', self.ui.package)
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
        self.ui.wait(Selector(id='bottom-navigation'), 35)
        self.api('/__test/events', {'event': 'webrtc:config', 'userId': 1, 'payload': {'iceServers': []}})
        self.ensure_call()
        self.ui.wait(Selector(description='Включить микрофон'))
        self.ui.checkpoint('muted-preference-survives-process-restart', {'rtp': self.connected()})
        self.set_microphone_muted(False)
        self.ui.tap(Selector(id='call-end'))
        self.ui.wait_absent(Selector(id='call-screen'))

    def party_revocation(self) -> None:
        for event in ['room:removed', 'party:roomClosed']:
            process_id = self.ui.run('shell', 'pidof', self.ui.package).strip()
            self.home('chats')
            self.ui.tap(Selector(id='chat-room-Вечерний пати'))
            self.ui.tap(Selector(id='chat-call'))
            self.ui.wait(Selector(id='call-screen'))
            self.peer_api('/joinParty', {'roomId': 10})
            self.ui.wait(Selector(id='call-participant-2'))
            self.connected()
            self.api('/__test/events', {'event': event, 'userId': 1, 'payload': {'roomId': 10}})
            self.ui.wait_absent(Selector(id='call-screen'))
            assert self.ui.run('shell', 'pidof', self.ui.package).strip() == process_id
            services = self.ui.run('shell', 'dumpsys', 'activity', 'services', self.ui.package)
            assert 'ServiceRecord' not in services, services
            self.ui.checkpoint('party-' + event.replace(':', '-') + '-cleans-call', {'services': services})
            self.peer_api('/leaveParty', {})
            self.ui.run('shell', 'am', 'force-stop', self.ui.package)
            self.ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
            self.ui.wait(Selector(id='bottom-navigation'), 35)
            self.api('/__test/events', {'event': 'webrtc:config', 'userId': 1, 'payload': {'iceServers': []}})

    def microphone_denial(self) -> None:
        self.peer_api('/hangup', {})
        self.ui.run('shell', 'am', 'force-stop', self.ui.package)
        permission = 'android.permission.RECORD_AUDIO'
        self.ui.run('shell', 'pm', 'revoke', self.ui.package, permission)
        self.ui.run('shell', 'pm', 'clear-permission-flags', self.ui.package, permission, 'user-set', 'user-fixed')
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
        self.ui.wait(Selector(id='bottom-navigation'), 35)
        self.peer_api('/call', {'username': 'Mika'})
        self.ui.tap(Selector(id='call-accept'))
        denied = Selector(id='com.android.permissioncontroller:id/permission_deny_button')
        self.ui.wait(denied)
        self.ui.checkpoint('microphone-first-permission')
        self.ui.tap(denied)
        self.ui.wait(Selector(contains='Для звонка нужен доступ к микрофону'))
        self.ui.checkpoint('microphone-denied-retry-available')
        assert not self.peer_api()['connections'], 'Microphone started despite denial'
        self.ui.tap(Selector(id='call-accept'))
        deny_permanently = Selector(id='com.android.permissioncontroller:id/permission_deny_and_dont_ask_again_button')
        self.ui.wait(deny_permanently)
        self.ui.tap(deny_permanently)
        self.ui.wait(Selector(text='Открыть настройки'))
        self.ui.checkpoint('microphone-permanently-denied')
        self.ui.tap(Selector(text='Открыть настройки'))
        self.ui.wait(Selector(text='Permissions'))
        self.ui.tap(Selector(text='Permissions'))
        self.ui.tap(Selector(text='Microphone'))
        self.ui.tap(Selector(text='Allow only while using the app'))
        self.ui.checkpoint('microphone-enabled-in-android-settings')
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
        self.ui.wait(Selector(id='call-accept'))
        self.ui.tap(Selector(id='call-accept'))
        self.ui.checkpoint('microphone-recovered-call', {'rtp': self.connected()})
        self.ui.tap(Selector(id='call-end'))
        self.ui.wait_absent(Selector(id='call-screen'))

    def background_notification(self) -> None:
        self.home('profile')
        self.ui.tap(Selector(description='Настройки'))
        toggle = self.ui.locate(Selector(id='notifications-toggle'), True)
        if toggle.attrib.get('checked') != 'true':
            self.ui.tap(Selector(id='notifications-toggle'), True)
        allow = Selector(id='com.android.permissioncontroller:id/permission_allow_button')
        if self.ui.find(allow) is not None:
            self.ui.checkpoint('notification-permission-request')
            self.ui.tap(allow)
        self.home('chats')
        self.ensure_call()
        initial = self.connected()
        self.ui.run('shell', 'input', 'keyevent', '3')
        time.sleep(2)
        background = self.connected()
        def received_bytes(status):
            return sum(stat.get('bytesReceived', 0) for peer in status['connections'] if peer['id'] == 1
                       for stat in peer['media'] if stat['type'] == 'inbound-rtp' and stat['kind'] == 'audio')
        assert received_bytes(background) > received_bytes(initial), 'Audio RTP stopped in background'
        self.ui.run('shell', 'cmd', 'statusbar', 'expand-notifications')
        self.ui.wait(Selector(text='PlayTime · Звонок'))
        self.ui.checkpoint('background-ongoing-call-notification', {'rtp': background})
        self.ui.tap(Selector(text='Нажмите, чтобы вернуться к звонку'))
        self.ui.wait(Selector(id='call-screen'))
        self.ui.checkpoint('notification-returned-to-call', {'rtp': self.connected()})
        self.ui.run('shell', 'input', 'keyevent', '3')
        self.ui.run('shell', 'cmd', 'statusbar', 'expand-notifications')
        self.ui.wait(Selector(text='PlayTime · Звонок'))
        end = Selector(text='Завершить')
        if self.ui.find(end) is None:
            self.ui.tap(Selector(description='Expand'))
        self.ui.tap(end)
        time.sleep(1)
        assert self.peer_api()['call'] is None, 'Notification action did not end call'
        self.ui.run('shell', 'cmd', 'statusbar', 'collapse')
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
        self.ui.wait_absent(Selector(id='call-screen'))
        services = self.ui.run('shell', 'dumpsys', 'activity', 'services', self.ui.package)
        assert 'ServiceRecord' not in services, services
        self.ui.checkpoint('notification-ended-call', {'services': services})

    def system_projection_stop(self) -> None:
        self.ensure_call()
        process_id = self.ui.run('shell', 'pidof', self.ui.package).strip()
        self.screen_consent(system_audio=True)
        self.connected(video=True)
        self.ui.wait(Selector(contains='Ваш экран · звук приложений'), 30)
        self.ui.checkpoint('system-projection-before-stop')
        self.ui.run('shell', 'input', 'tap', str(round(self.ui.width * 0.25)), str(round(self.ui.height * 0.028)))
        self.ui.wait(Selector(id='android:id/button1'))
        self.ui.checkpoint('android-stop-projection-dialog')
        self.ui.tap(Selector(id='android:id/button1'))
        self.ui.wait(Selector(description='Показать экран'))
        self.ui.wait_absent(Selector(contains='Ваш экран · звук приложений'))
        assert self.ui.run('shell', 'pidof', self.ui.package).strip() == process_id
        self.ui.checkpoint('system-projection-stopped-voice-retained', {'rtp': self.connected()})
        self.ui.tap(Selector(id='call-end'))
        self.ui.wait_absent(Selector(id='call-screen'))
        time.sleep(0.5)
        assert self.ui.run('shell', 'pidof', self.ui.package).strip() == process_id
        services = self.ui.run('shell', 'dumpsys', 'activity', 'services', self.ui.package)
        assert 'ServiceRecord' not in services, services
        self.ui.checkpoint('system-projection-cleanup', {'nativePid': process_id, 'services': services})

    def party_system_audio(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-room-Вечерний пати'))
        self.ui.tap(Selector(id='chat-call'))
        self.ui.wait(Selector(id='call-screen'))
        self.ui.wait(Selector(contains='Вы первым вошли'))
        self.screen_consent(system_audio=True)
        self.ui.wait(Selector(contains='Ваш экран · звук приложений'), 30)
        self.ui.checkpoint('party-sharing-before-peer-joins')
        self.peer_api('/joinParty', {'roomId': 10})
        self.ui.wait(Selector(id='call-participant-2'))
        self.connected(video=True)
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtime.audiofixture/.MainActivity')
        self.ui.tap(Selector(text='Play external 880 Hz tone'))
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
        time.sleep(0.6)
        self.ui.checkpoint('late-party-peer-receives-screen-and-880hz', {'rtp': self.screen_signal(True)})
        self.peer_api('/leaveParty', {})
        self.ui.wait_absent(Selector(id='call-participant-2'))
        self.peer_api('/joinParty', {'roomId': 10})
        self.ui.wait(Selector(id='call-participant-2'))
        self.ui.checkpoint('party-peer-rejoined-during-system-audio', {'rtp': self.screen_signal(True)})
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtime.audiofixture/.MainActivity')
        self.ui.tap(Selector(text='Stop tone'))
        self.ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
        self.ui.tap(Selector(id='call-end'))
        self.ui.wait_absent(Selector(id='call-screen'))
        self.peer_api('/leaveParty', {})
        services = self.ui.run('shell', 'dumpsys', 'activity', 'services', self.ui.package)
        assert 'ServiceRecord' not in services, services
        self.ui.checkpoint('party-system-audio-ended', {'services': services})

    def concurrent_shares(self) -> None:
        assert self.secondary_peer
        self.peer_api('/hangup', {})
        self.peer_api('/hangup', {}, self.secondary_peer)
        self.home('chats')
        self.ui.tap(Selector(id='chat-room-Вечерний пати'))
        self.ui.tap(Selector(id='chat-call'))
        self.ui.wait(Selector(id='call-screen'))
        self.peer_api('/joinParty', {'roomId': 10})
        self.peer_api('/joinParty', {'roomId': 10}, self.secondary_peer)
        self.ui.wait(Selector(id='call-participant-3'))
        self.connected()
        self.peer_api('/share', {'enabled': True})
        self.peer_api('/share', {'enabled': True}, self.secondary_peer)
        self.ui.wait(Selector(id='call-screen-2'))
        self.ui.wait(Selector(id='call-screen-3'))
        self.ui.tap(Selector(id='call-screen-2'))
        time.sleep(1)
        self.ui.checkpoint('concurrent-shares-nova-selected')
        self.ui.tap(Selector(id='call-screen-3'))
        time.sleep(1)
        self.ui.checkpoint('concurrent-shares-orbit-selected')
        self.peer_api('/share', {'enabled': False}, self.secondary_peer)
        self.ui.wait_absent(Selector(id='call-screen-3'))
        self.ui.wait(Selector(id='call-screen-2'))
        self.ui.checkpoint('concurrent-share-stop-falls-back')
        self.peer_api('/share', {'enabled': False})
        self.ui.wait_absent(Selector(id='call-open-screen'))
        self.ui.checkpoint('concurrent-shares-ended-voice-retained', {'rtp': self.connected()})
        self.ui.tap(Selector(id='call-end'))
        self.peer_api('/leaveParty', {})
        self.peer_api('/leaveParty', {}, self.secondary_peer)

    def party(self) -> None:
        assert self.secondary_peer, '--secondary-peer is required for the party scenario'
        self.peer_api('/hangup', {})
        self.peer_api('/hangup', {}, self.secondary_peer)
        self.home('chats')
        self.ui.tap(Selector(id='chat-room-Вечерний пати'))
        self.ui.tap(Selector(id='chat-call'))
        self.microphone()
        self.ui.wait(Selector(id='call-screen'))
        self.peer_api('/joinParty', {'roomId': 10})
        self.peer_api('/joinParty', {'roomId': 10}, self.secondary_peer)
        self.ui.wait(Selector(id='call-participant-2'))
        self.ui.wait(Selector(id='call-participant-3'))
        self.connected()
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            secondary = self.peer_api(base=self.secondary_peer)
            android = next((peer for peer in secondary['connections'] if peer['id'] == 1), None)
            if android and android['connection'] == 'connected' and any(
                stat.get('bytesReceived', 0) > 0 for stat in android['media']
                if stat['type'] == 'inbound-rtp' and stat['kind'] == 'audio'
            ):
                break
            time.sleep(0.4)
        else:
            raise AssertionError(f'Second party participant has no Android RTP: {secondary}')
        self.ui.checkpoint('party-three-participants', {
            'reference': self.peer_api(),
            'desktop': secondary,
        })
        self.peer_api('/leaveParty', {}, self.secondary_peer)
        self.ui.wait_absent(Selector(id='call-participant-3'))
        self.ui.wait(Selector(id='call-participant-2'))
        self.ui.checkpoint('party-participant-left', {'rtp': self.connected()})
        self.peer_api('/joinParty', {'roomId': 10}, self.secondary_peer)
        self.ui.wait(Selector(id='call-participant-3'))
        self.ui.checkpoint('party-participant-rejoined')
        self.ui.tap(Selector(id='call-end'))
        self.peer_api('/leaveParty', {})
        self.peer_api('/leaveParty', {}, self.secondary_peer)
        self.ui.checkpoint('party-ended')

    def connected(self, video: bool = False, timeout: float = 30) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status = self.peer_api()
            for peer in status['connections']:
                if peer['id'] != 1:
                    continue
                received = [item for item in peer['media'] if item['type'] == 'inbound-rtp' and item['kind'] == ('video' if video else 'audio')]
                sent = [item for item in peer['media'] if item['type'] == 'outbound-rtp' and item['kind'] == 'audio']
                media_received = any(
                    item.get('bytesReceived', 0) > 0 and (not video or item.get('framesDecoded', 0) > 0)
                    for item in received
                )
                if peer['connection'] == 'connected' and media_received and any(item.get('bytesSent', 0) > 0 for item in sent):
                    assert not status['errors'], status['errors']
                    return status
            time.sleep(0.4)
        raise AssertionError(f'Bidirectional RTP did not start: {self.peer_api()}')

    def microphone(self) -> None:
        for resource in ['permission_allow_foreground_only_button', 'permission_allow_button']:
            selector = Selector(id=f'com.android.permissioncontroller:id/{resource}')
            if self.ui.find(selector) is not None:
                self.ui.checkpoint('call-microphone-permission')
                self.ui.tap(selector)
                break

    def outgoing(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.tap(Selector(id='chat-call'))
        self.microphone()
        self.ui.wait(Selector(id='call-screen'))
        status = self.connected()
        self.ui.checkpoint('outgoing-connected', {'rtp': status, 'layout': self.ui.assert_safe('call-end', 'call-mute')})
        self.set_microphone_muted(True)
        self.ui.checkpoint('call-muted')
        self.set_microphone_muted(False)
        self.ui.tap(Selector(id='call-speaker'))
        self.ui.checkpoint('call-speaker')
        self.ui.tap(Selector(id='call-volume'))
        self.ui.tap(Selector(id='call-volume-control-up'))
        self.ui.wait(Selector(text='110%'))
        self.ui.checkpoint('call-master-volume')
        self.ui.tap(Selector(id='call-volume-done'))
        self.ui.tap(Selector(id='call-participant-2'))
        self.ui.tap(Selector(id='call-volume-control-down'))
        self.ui.wait(Selector(text='90%'))
        self.ui.checkpoint('call-peer-volume')
        self.ui.tap(Selector(id='call-volume-done'))
        self.ui.tap(Selector(id='call-minimize'))
        self.ui.wait(Selector(id='active-call-bar'))
        self.ui.checkpoint('call-minimized')
        self.ui.tap(Selector(id='active-call-bar'))
        self.peer_api('/reconnect', {})
        status = self.connected()
        self.ui.checkpoint('call-reconnected', {'rtp': status})

    def remote_screen(self) -> None:
        self.ensure_call()
        self.peer_api('/share', {'enabled': True})
        self.ui.wait(Selector(id='call-open-screen'), 25)
        self.ui.checkpoint('desktop-screen-received', {'rtp': self.peer_api()})
        self.ui.tap(Selector(id='call-open-screen'))
        self.ui.wait(Selector(id='call-close-fullscreen'))
        self.ui.checkpoint('desktop-screen-fullscreen')
        try:
            self.ui.run('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
            self.ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '1')
            time.sleep(1)
            self.ui.checkpoint('desktop-screen-landscape')
        finally:
            self.ui.run('shell', 'settings', 'put', 'system', 'user_rotation', '0')
            time.sleep(0.5)
        self.ui.tap(Selector(id='call-close-fullscreen'))
        self.ui.tap(Selector(description='Выключить звук экрана'), True)
        self.ui.checkpoint('desktop-screen-audio-muted')
        self.ui.tap(Selector(description='Включить звук экрана'), True)
        self.peer_api('/share', {'enabled': False})
        time.sleep(0.6)
        self.ui.absent(Selector(id='call-open-screen'))

    def incoming(self) -> None:
        if self.ui.find(Selector(id='call-end')) is not None:
            self.ui.tap(Selector(id='call-end'))
        self.home('chats')
        self.peer_api('/call', {'username': 'Mika'})
        self.ui.wait(Selector(id='call-reject'))
        self.ui.checkpoint('incoming-call', self.ui.assert_safe('call-accept', 'call-reject'))
        self.ui.tap(Selector(id='call-reject'))
        time.sleep(0.5)
        self.ui.absent(Selector(id='incoming-call'))
        self.peer_api('/call', {'username': 'Mika'})
        self.ui.wait(Selector(id='call-accept'))
        self.ui.tap(Selector(id='call-accept'))
        self.microphone()
        self.ui.wait(Selector(id='call-screen'))
        self.ui.checkpoint('incoming-accepted', {'rtp': self.connected()})
        self.ui.tap(Selector(id='call-end'))
        time.sleep(0.5)
        self.ui.absent(Selector(id='call-screen'))
        assert self.peer_api()['call'] is None
        self.ui.checkpoint('call-ended')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--adb', default=UI.DEFAULT_ADB)
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--fixture', default='http://127.0.0.1:1502')
    parser.add_argument('--peer', default='http://127.0.0.1:1503')
    parser.add_argument('--secondary-peer')
    parser.add_argument('--turn-transport', choices=['udp', 'tcp'])
    parser.add_argument('--direct', action='store_true', help='Use mapped host ICE for the isolated emulator peer')
    parser.add_argument('--groups', default='outgoing,remote_screen,incoming')
    parser.add_argument('--output', type=Path, default=Path(__file__).parent / 'artifacts' / ('calls-' + time.strftime('%Y%m%d-%H%M%S')))
    parser.add_argument('--reset-peer', action='store_true')
    args = parser.parse_args()
    ui = UI.AndroidUI(args.adb, args.serial, args.output, 'com.playtimemobile')
    suite = CallSuite(ui, args.fixture, args.peer, args.secondary_peer)
    try:
        ui.run('shell', 'am', 'start', '-n', 'com.playtimemobile/.MainActivity')
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            tree = ui.tree()
            if any(ui.find(Selector(id=identifier), tree) is not None for identifier in [
                'call-screen', 'bottom-navigation', 'incoming-call', 'auth-screen', 'chat-screen',
            ]):
                break
            time.sleep(0.3)
        else:
            raise AssertionError('Android app did not finish starting')
        if ui.find(Selector(id='auth-screen')) is not None:
            suite.login()
        if args.turn_transport or args.direct:
            suite.api('/__test/events', {
                'event': 'webrtc:config',
                'userId': 1,
                'payload': {'iceServers': [] if args.direct else [{
                    'urls': f'turn:10.0.2.2:3478?transport={args.turn_transport}',
                    'username': 'playtime-e2e',
                    'credential': 'local-e2e-only',
                }]},
            })
        if args.reset_peer:
            suite.peer_api('/reset', {})
            time.sleep(1)
        for group in args.groups.split(','):
            suite.run_group(group)
    except Exception as error:
        print(f'FAILED: {error}', file=sys.stderr, flush=True)
        return 1
    print(f'Native WebRTC scenarios passed. Evidence: {args.output}', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
