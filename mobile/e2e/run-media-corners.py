#!/usr/bin/env python3
"""Native media failures, plan limits, decrypted images and audio preview controls."""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import struct
import sys
import time
import zlib

SPEC = importlib.util.spec_from_file_location('playtime_media_ui', Path(__file__).with_name('run-ui.py'))
assert SPEC and SPEC.loader
UI = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = UI
SPEC.loader.exec_module(UI)
Selector = UI.Selector


def write_image(path: Path) -> None:
    width, height = 640, 400
    pixels = b''.join(b'\0' + bytes(channel for x in range(width) for channel in (25 + x * 90 // width, 40 + y * 90 // height, 185)) for y in range(height))

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))

    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))


class MediaCorners(UI.Suite):
    def open_nova(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.fill(Selector(id='message-input'), '', hide=True)

    def choose(self, path: Path) -> None:
        self.ui.run('push', str(path), '/sdcard/Download/' + path.name)
        self.ui.tap(Selector(id='chat-attach'))
        self.pick_download(path.name)

    def retry_limits(self) -> None:
        self.open_nova()
        path = self.ui.output / 'Retry-encrypted.txt'
        path.write_text('Retry must preserve this encrypted attachment.\n', encoding='utf8')
        previous = {item['id'] for item in self.state()['messages']}
        self.choose(path)
        self.api('/__test/events', {'action': 'failure', 'path': '/attachments/upload', 'status': 503})
        try:
            self.ui.tap(Selector(id='attachment-send'))
            self.ui.wait(Selector(contains='сервер временно недоступен'))
            self.ui.wait(Selector(id='attachment-preview'))
            assert not any(item['id'] not in previous for item in self.state()['messages'])
            self.ui.checkpoint('attachment-upload-failure-retains-preview')
        finally:
            self.api('/__test/events', {'action': 'clearFailures'})
        self.ui.tap(Selector(id='attachment-send'))
        state = self.until(lambda data: any(item['id'] not in previous and item.get('attachmentKey') for item in data['messages']))
        message = next(item for item in reversed(state['messages']) if item['id'] not in previous)
        self.ui.wait_absent(Selector(id='attachment-preview'))
        self.ui.wait(Selector(id=f"message-{message['id']}"))
        self.ui.checkpoint('attachment-retry-sends-once')
        assert len([item for item in state['messages'] if item['id'] not in previous]) == 1
        self.api('/__test/events', {'action': 'failure', 'path': '/attachments/' + message['attachmentKey'], 'status': 404})
        try:
            self.ui.tap(Selector(description='Открыть вложение Retry-encrypted.txt'))
            self.ui.wait(Selector(contains='Вложение удалено или недоступно'))
            self.ui.checkpoint('attachment-download-not-found-visible')
        finally:
            self.api('/__test/events', {'action': 'clearFailures'})
        self.ui.tap(Selector(description='Открыть вложение Retry-encrypted.txt'))
        self.ui.wait(Selector(contains='Sharing 1 file'))
        self.ui.checkpoint('attachment-download-retry-decrypts')
        self.ui.back()
        self.api('/__test/events', {'action': 'plan', 'planSlug': 'free'})
        time.sleep(1)
        oversized = self.ui.output / 'Above-free-limit.bin'
        oversized.write_bytes(b'A' * (524288 + 1))
        before = len(self.state()['uploads'])
        try:
            self.choose(oversized)
            self.ui.wait(Selector(contains='для вашего плана'))
            self.ui.absent(Selector(id='attachment-preview'))
            assert len(self.state()['uploads']) == before
            self.ui.checkpoint('attachment-plan-limit-before-upload')
        finally:
            self.api('/__test/events', {'action': 'plan', 'planSlug': 'pro'})
        empty = self.ui.output / 'Empty-attachment.txt'
        empty.write_bytes(b'')
        self.choose(empty)
        self.ui.wait(Selector(contains='Размер файла'))
        self.ui.absent(Selector(id='attachment-preview'))
        self.ui.checkpoint('attachment-empty-file-rejected')

    def voice(self) -> None:
        self.open_nova()
        before = len(self.state()['messages'])
        self.ui.tap(Selector(id='voice-record'))
        self.ui.wait(Selector(id='voice-stop'))
        time.sleep(1)
        self.ui.tap(Selector(description='Отменить запись'))
        self.ui.wait_absent(Selector(id='voice-stop'))
        self.ui.absent(Selector(id='voice-preview'))
        self.ui.checkpoint('voice-cancel-recording')
        self.ui.tap(Selector(id='voice-record'))
        self.ui.wait(Selector(id='voice-stop'))
        time.sleep(8)
        self.ui.tap(Selector(id='voice-stop'))
        self.ui.wait(Selector(id='voice-preview'))
        self.ui.tap(Selector(id='voice-preview-play'))
        self.ui.wait(Selector(description='Приостановить голосовое'))
        self.ui.tap(Selector(id='voice-preview-play'))
        self.ui.wait(Selector(description='Прослушать голосовое'))
        self.ui.checkpoint('voice-preview-paused')
        slider = self.ui.wait(Selector(description='Позиция голосового сообщения'))
        left, top, right, bottom = self.ui.bounds(slider)
        self.ui.run('shell', 'input', 'tap', str(left + (right - left) * 2 // 3), str((top + bottom) // 2))
        time.sleep(0.4)
        self.ui.checkpoint('voice-preview-seek')
        self.ui.tap(Selector(id='voice-preview-play'))
        self.ui.wait(Selector(description='Приостановить голосовое'))
        self.ui.checkpoint('voice-preview-resumes-after-seek')
        self.ui.tap(Selector(id='voice-discard'))
        self.ui.wait_absent(Selector(id='voice-preview'))
        assert len(self.state()['messages']) == before
        self.ui.checkpoint('voice-preview-discard-stops-playback')
        self.ui.tap(Selector(id='voice-record'))
        self.ui.wait(Selector(id='voice-stop'))
        self.ui.run('shell', 'input', 'keyevent', '3')
        time.sleep(0.5)
        self.ui.run('shell', 'am', 'start', '-n', f'{self.ui.package}/.MainActivity')
        self.ui.wait(Selector(contains='Запись прервана'))
        self.ui.absent(Selector(id='voice-stop'))
        self.ui.absent(Selector(id='voice-preview'))
        self.ui.checkpoint('voice-background-interruption-cleans-up')

    def cold_images(self) -> None:
        self.ui.run('shell', 'am', 'force-stop', self.ui.package)
        self.ui.run('shell', 'am', 'start', '-n', f'{self.ui.package}/.MainActivity')
        self.ui.wait(Selector(id='bottom-navigation'), 45)
        self.open_nova()
        self.ui.wait(Selector(id='attachment-inline-image'), 30)
        self.ui.checkpoint('cold-start-decrypted-inline-images-restored')
        self.api('/__test/events', {'action': 'incomingMessage', 'text': 'Image previews survive history refresh'})
        self.ui.wait(Selector(contains='Image previews survive history refresh'))
        self.ui.wait(Selector(id='attachment-inline-image'))
        self.ui.checkpoint('history-refresh-retains-decrypted-inline-images')

    def image(self) -> None:
        self.open_nova()
        path = self.ui.output / 'Android-gradient.png'
        write_image(path)
        previous = {item['id'] for item in self.state()['messages']}
        self.choose(path)
        self.ui.wait(Selector(id='attachment-preview'))
        self.ui.checkpoint('image-attachment-preview')
        self.ui.tap(Selector(id='attachment-send'))
        state = self.until(lambda data: any(item['id'] not in previous and item.get('attachmentKey') for item in data['messages']))
        message = next(item for item in reversed(state['messages']) if item['id'] not in previous)
        upload = next(item for item in state['uploads'] if item['key'] == message['attachmentKey'])
        assert upload['bytes'] == path.stat().st_size + 16
        self.ui.wait_absent(Selector(id='attachment-preview'))
        self.ui.wait(Selector(id=f"message-{message['id']}"))
        time.sleep(0.7)
        self.ui.checkpoint('image-decrypted-inline-preview')
        self.ui.tap(Selector(description='Открыть вложение Android-gradient.png'))
        self.ui.wait(Selector(description='Закрыть изображение'))
        self.ui.checkpoint('image-fullscreen-safe-zone')
        self.ui.tap(Selector(description='Увеличить изображение'))
        self.ui.wait(Selector(description='Уменьшить изображение'))
        self.ui.checkpoint('image-zoomed')
        self.ui.tap(Selector(description='Поделиться изображением'))
        self.ui.wait(Selector(contains='Sharing image'))
        self.ui.checkpoint('image-share-decrypted-file')
        self.ui.back()
        self.ui.tap(Selector(description='Закрыть изображение'))
        self.ui.wait(Selector(id='chat-screen'))
        self.ui.checkpoint('image-close-restores-chat')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--adb', default=UI.DEFAULT_ADB)
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--fixture', default='http://127.0.0.1:1502')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--groups', default='retry_limits,voice,image')
    args = parser.parse_args()
    ui = UI.AndroidUI(args.adb, args.serial, args.output, 'com.playtimemobile')
    suite = MediaCorners(ui, args.fixture)
    try:
        for group in args.groups.split(','):
            suite.run_group(group)
    except Exception as error:
        print(f'FAILED: {error}', file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
