#!/usr/bin/env python3
"""Additional native chat boundaries using real UI, ciphertext and fixture assertions."""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import sys
import time

SPEC = importlib.util.spec_from_file_location('playtime_chat_ui', Path(__file__).with_name('run-ui.py'))
assert SPEC and SPEC.loader
UI = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = UI
SPEC.loader.exec_module(UI)
Selector = UI.Selector


class ChatCorners(UI.Suite):
    def open_nova(self) -> None:
        self.home('chats')
        self.ui.tap(Selector(id='chat-Nova'))
        self.ui.wait(Selector(id='message-input'))

    def send_text(self, value: str) -> int:
        previous = {message['id'] for message in self.state()['messages']}
        self.ui.fill(Selector(id='message-input'), value)
        self.ui.tap(Selector(id='message-send'))
        result = self.until(lambda state: any(message['id'] not in previous and message['senderId'] == 1 for message in state['messages']))
        message = next(message for message in reversed(result['messages']) if message['id'] not in previous and message['senderId'] == 1)
        assert message['content'].startswith('E2E1:') and value not in message['content']
        self.ui.hide_keyboard()
        self.ui.wait(Selector(id=f"message-{message['id']}"))
        return message['id']

    def boundaries(self) -> None:
        self.open_nova()
        self.ui.fill(Selector(id='message-input'), '   ')
        self.ui.absent(Selector(id='message-send'))
        self.ui.checkpoint('whitespace-cannot-send', self.ui.assert_keyboard('voice-record'))
        self.ui.fill(Selector(id='message-input'), '')
        for _ in range(35):
            length = len(self.ui.wait(Selector(id='message-input')).attrib.get('text', ''))
            if length == 2000:
                break
            self.ui.run('shell', 'input', 'text', 'a' * min(100, 2001 - length))
            time.sleep(0.3)
        self.ui.run('shell', 'input', 'text', 'overflow')
        time.sleep(0.4)
        assert len(self.ui.wait(Selector(id='message-input')).attrib.get('text', '')) == 2000, 'Native input must cap text at 2000 characters'
        self.ui.checkpoint('message-2000-character-limit', self.ui.assert_keyboard())
        self.ui.fill(Selector(id='message-input'), '', hide=True)
        self.ui.tap(Selector(description='Эмодзи'))
        self.ui.wait(Selector(id='emoji-picker'))
        self.ui.checkpoint('full-emoji-picker')
        def visible_glyphs() -> set[str]:
            return {node.attrib.get('content-desc', '') for node in self.ui.tree().iter('node') if node.attrib.get('content-desc', '').startswith('Вставить ')}

        initial = visible_glyphs()
        list_node = self.ui.wait(Selector(id='emoji-list'))
        left, top, right, bottom = self.ui.bounds(list_node)
        x = (left + right) // 2
        for _ in range(8):
            self.ui.run('shell', 'input', 'swipe', str(x), str(bottom - 12), str(x), str(top + 12), '220')
        time.sleep(0.5)
        distant = visible_glyphs()
        assert distant and distant != initial, 'Continuous emoji list must expose distant glyphs after scrolling'
        assert len(distant) < 150, 'Emoji accessibility tree must not mount the entire 901-glyph catalogue'
        self.ui.checkpoint('emoji-continuous-virtualized-scroll')
        selected = sorted(distant)[len(distant) // 2]
        self.ui.tap(Selector(description=selected))
        self.ui.tap(Selector(description='Частые'))
        self.ui.wait(Selector(description=selected))
        self.ui.checkpoint('frequent-emoji-recorded')
        self.ui.tap(Selector(description='Закрыть эмодзи'))
        self.ui.wait(Selector(text=selected.removeprefix('Вставить ')))
        self.ui.fill(Selector(id='message-input'), '', hide=True)

    def references(self) -> None:
        self.open_nova()
        message_id = self.send_text('Corner reference source')
        original = next(message['content'] for message in self.state()['messages'] if message['id'] == message_id)
        self.ui.fill(Selector(id='message-input'), 'Draft preserved through edit', hide=True)
        self.ui.hold(Selector(id=f'message-{message_id}'))
        self.ui.tap(Selector(description='Редактировать'))
        self.ui.fill(Selector(id='message-input'), 'Cancelled edit', hide=True)
        self.ui.tap(Selector(description='Отменить ответ или редактирование'))
        self.ui.wait(Selector(text='Draft preserved through edit'))
        assert next(message['content'] for message in self.state()['messages'] if message['id'] == message_id) == original
        self.ui.checkpoint('edit-cancel-restores-draft')
        self.ui.fill(Selector(id='message-input'), '', hide=True)
        self.ui.hold(Selector(id=f'message-{message_id}'))
        self.ui.tap(Selector(description='Ответить'))
        self.ui.hide_keyboard()
        self.ui.tap(Selector(description='Отменить ответ или редактирование'))
        self.ui.absent(Selector(description='Отменить ответ или редактирование'))
        self.ui.checkpoint('reply-cancelled')
        self.ui.hold(Selector(id=f'message-{message_id}'))
        self.ui.tap(Selector(description='Реакция 👍'))
        self.until(lambda state: any(message['id'] == message_id and message.get('reactions') for message in state['messages']))
        self.ui.hold(Selector(id=f'message-{message_id}'))
        self.ui.tap(Selector(description='Реакция 👍'))
        self.until(lambda state: any(message['id'] == message_id and not message.get('reactions') for message in state['messages']))
        self.ui.checkpoint('reaction-toggled-off')
        self.ui.hold(Selector(id=f'message-{message_id}'))
        self.ui.tap(Selector(description='Закрепить'))
        self.ui.wait(Selector(contains='Закреплённое сообщение'))
        self.ui.hold(Selector(id=f'message-{message_id}'))
        self.ui.tap(Selector(description='Открепить'))
        self.ui.wait_absent(Selector(contains='Закреплённое сообщение'))
        self.ui.checkpoint('message-unpinned')

    def search(self) -> None:
        self.open_nova()
        query = 'RepeatedSearchToken' + str(int(time.time()))
        self.send_text(query + ' first')
        self.send_text(query + ' second')
        self.ui.tap(Selector(id='chat-menu'))
        self.ui.tap(Selector(description='Поиск в переписке'))
        self.ui.fill(Selector(id='history-search'), query, hide=True)
        self.ui.wait(Selector(text='2 из 2'))
        self.ui.tap(Selector(id='search-previous'))
        self.ui.wait(Selector(text='1 из 2'))
        self.ui.checkpoint('search-previous-match')
        self.ui.tap(Selector(id='search-next'))
        self.ui.wait(Selector(text='2 из 2'))
        self.ui.checkpoint('search-next-match')
        self.ui.fill(Selector(id='history-search'), 'NoSuchText987654', hide=True)
        self.ui.wait(Selector(text='Совпадений нет'))
        assert self.ui.wait(Selector(id='search-next')).attrib['enabled'] == 'false'
        self.ui.checkpoint('search-no-matches')
        self.ui.tap(Selector(description='Закрыть поиск'))
        self.ui.wait_absent(Selector(id='history-search'))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--adb', default=UI.DEFAULT_ADB)
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--fixture', default='http://127.0.0.1:1502')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--groups', default='boundaries,references,search')
    args = parser.parse_args()
    ui = UI.AndroidUI(args.adb, args.serial, args.output, 'com.playtimemobile')
    suite = ChatCorners(ui, args.fixture)
    try:
        for group in args.groups.split(','):
            suite.run_group(group)
    except Exception as error:
        print(f'FAILED: {error}', file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
