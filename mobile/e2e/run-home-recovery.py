#!/usr/bin/env python3
"""Native home acceptance against an isolated localhost protocol fixture only."""
import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

spec = importlib.util.spec_from_file_location('native_ui', Path(__file__).with_name('run-ui.py'))
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
AndroidUI, Selector, Suite = module.AndroidUI, module.Selector, module.Suite


class HomeRecovery(Suite):
    def cold(self, authenticated: bool = True) -> None:
        self.ui.run('shell', 'am', 'force-stop', self.ui.package)
        self.ui.run('shell', 'am', 'start', '-n', self.ui.package + '/.MainActivity')
        self.ui.wait(Selector(id='bottom-navigation' if authenticated else 'auth-screen'), 40)

    def friends(self, name: str) -> None:
        self.home('friends')
        self.ui.wait(Selector(contains='2 всего'), 30)
        self.ui.locate(Selector(text='Nova'), True)
        self.ui.locate(Selector(text='Orbit'), True)
        self.ui.checkpoint(name)

    def plan(self, name: str, expected: str = 'Pro') -> None:
        self.home('profile')
        self.ui.wait(Selector(text=expected), 30)
        self.ui.tap(Selector(text=expected))
        self.ui.wait(Selector(id='plan-screen'))
        self.ui.wait(Selector(text=expected))
        self.ui.wait(Selector(text='Участников в комнате'))
        self.ui.absent(Selector(contains='Загружаем условия'))
        self.ui.checkpoint(name)

    def reconnect(self) -> None:
        self.home('friends')
        self.api('/__test/events', {'action': 'disconnect'})
        self.ui.wait(Selector(id='connection-banner'))
        self.ui.tap(Selector(id='connection-banner'))
        self.ui.wait_absent(Selector(id='connection-banner'), 30)

    def baseline(self) -> None:
        if self.ui.find(Selector(id='auth-screen')) is None and self.ui.find(Selector(id='bottom-navigation')) is None:
            self.cold(authenticated=False)
        if self.ui.find(Selector(id='auth-screen')) is not None:
            self.login()
        self.friends('startup-friends-loaded')
        self.plan('startup-pro-plan-loaded')
        state = self.state()
        assert any(row['event'] == 'presence:listByUserId' and row['argumentTypes'] == ['function']
                   for row in state['captured']), 'Presence ACK was not sent as callback-only'
        assert any(row['path'] == '/subscription/me' and row['status'] == 200
                   for row in state['requests']), 'Subscription HTTP success missing'

    def busy(self) -> None:
        self.api('/__test/events', {'action': 'socketFailure', 'event': 'presence:listByUserId',
                                    'message': 'Сервер занят. Повторите попытку.'})
        self.cold()
        self.plan('busy-presence-does-not-block-plan')
        self.api('/__test/events', {'action': 'clearFailures'})
        self.reconnect()
        self.friends('busy-presence-recovered-friends')
        self.plan('busy-presence-recovered-plan')

    def subscription_failure(self) -> None:
        self.api('/__test/events', {'action': 'failure', 'path': '/subscription/me', 'status': 503})
        self.cold()
        self.friends('subscription-503-does-not-block-friends')
        assert any(row['path'] == '/subscription/me' and row['status'] == 503
                   for row in self.state()['requests']), 'Subscription failure was not exercised'
        self.api('/__test/events', {'action': 'clearFailures'})
        self.reconnect()
        self.plan('subscription-503-recovered-plan')

    def lifecycle(self) -> None:
        self.home('friends')
        pid = self.ui.run('shell', 'pidof', self.ui.package).strip()
        self.ui.run('shell', 'input', 'keyevent', '3')
        self.api('/__test/events', {'action': 'plan', 'planSlug': 'free'})
        time.sleep(1)
        self.ui.run('shell', 'am', 'start', '-n', self.ui.package + '/.MainActivity')
        self.ui.wait(Selector(id='bottom-navigation'), 30)
        assert self.ui.run('shell', 'pidof', self.ui.package).strip() == pid
        self.friends('background-return-retains-friends')
        self.plan('background-return-refreshes-plan', 'Free')
        self.api('/__test/events', {'action': 'plan', 'planSlug': 'pro'})
        self.reconnect()
        self.friends('reconnect-friends-loaded')
        self.plan('reconnect-pro-plan-loaded')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', default='emulator-5558')
    parser.add_argument('--fixture', default='http://127.0.0.1:1516')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--groups', default='baseline,busy,subscription_failure,lifecycle')
    args = parser.parse_args()
    assert urlparse(args.fixture).hostname in ('127.0.0.1', 'localhost'), 'Local fixture only'
    ui = AndroidUI(module.DEFAULT_ADB, args.serial, args.output, 'com.playtimemobile')
    suite = HomeRecovery(ui, args.fixture)
    report = {'variant': 'debug APK with Metro and localhost protocol fixture; not production release QA',
              'device': args.serial, 'groups': []}
    try:
        for group in args.groups.split(','):
            print('RUN ' + group, flush=True)
            getattr(suite, group)()
            report['groups'].append({'group': group, 'status': 'passed'})
        report['status'] = 'passed'
    except Exception as error:
        report.update(status='failed', error=str(error))
        ui.checkpoint('home-recovery-failure')
        raise
    finally:
        suite.api('/__test/events', {'action': 'clearFailures'})
        report['checkpoints'] = ui.checkpoints
        (ui.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=4))


if __name__ == '__main__':
    main()
