import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AudioPlayback,
    type AudioDriver,
    type AudioProgress,
} from '../src/platform/PlaybackController';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function driver() {
    const calls: string[] = [];
    const value: AudioDriver = {
        playAudio: async (uri) => {
            calls.push(`play:${uri}`);
            return true;
        },
        stopAudio: async () => {
            calls.push('stop');
            return true;
        },
        pauseAudio: async () => {
            calls.push('pause');
            return true;
        },
        resumeAudio: async () => {
            calls.push('resume');
            return true;
        },
        seekAudio: async (ms) => {
            calls.push(`seek:${ms}`);
            return true;
        },
        getAudioProgress: async () => ({ positionMs: 300, durationMs: 1000, playing: true }),
    };
    return { value, calls };
}

test('a slow first download cannot interrupt the newer voice message', async () => {
    const native = driver();
    const player = new AudioPlayback(native.value);
    const first = deferred<string>();
    const pending = player.toggle('first', () => first.promise, 1000);
    await player.toggle('second', async () => 'second.m4a', 2000);
    first.resolve('first.m4a');
    await pending;
    assert.deepEqual(
        native.calls.filter((call) => call.startsWith('play:')),
        ['play:second.m4a'],
    );
    assert.equal(player.getSnapshot().owner, 'second');
});

test('leaving a screen cancels a pending download without affecting the next owner', async () => {
    const native = driver();
    const player = new AudioPlayback(native.value);
    const download = deferred<string>();
    const pending = player.toggle('old-screen', () => download.promise, 1000);
    await player.stop('old-screen');
    await player.toggle('new-screen', async () => 'next.m4a', 1000);
    await player.stop('old-screen');
    download.resolve('stale.m4a');
    await pending;
    assert.equal(player.getSnapshot().owner, 'new-screen');
    assert.equal(native.calls.includes('play:stale.m4a'), false);
});

test('late progress from an old track cannot change the new player state', async () => {
    const native = driver();
    const progress = deferred<AudioProgress>();
    native.value.getAudioProgress = () => progress.promise;
    const player = new AudioPlayback(native.value);
    await player.toggle('old', async () => 'old.m4a', 1000);
    const pending = player.poll();
    await player.toggle('new', async () => 'new.m4a', 2000);
    progress.resolve({ positionMs: 999, durationMs: 1000, playing: false });
    await pending;
    assert.equal(player.getSnapshot().durationMs, 2000);
    assert.equal(player.getSnapshot().playing, true);
    assert.equal(player.getSnapshot().positionMs, 0);
});

test('pause resumes the existing track and completed replay seeks to the beginning', async () => {
    const native = driver();
    const player = new AudioPlayback(native.value);
    const load = async () => 'voice.m4a';
    await player.toggle('voice', load, 1000);
    await player.toggle('voice', load, 1000);
    assert.equal(player.getSnapshot().playing, false);
    await player.toggle('voice', load, 1000);
    await player.seek('voice', 0.5);
    player.ended();
    await player.toggle('voice', load, 1000);
    assert.deepEqual(native.calls, [
        'stop',
        'play:voice.m4a',
        'pause',
        'resume',
        'seek:500',
        'seek:0',
        'resume',
    ]);
});

test('failed download can be retried and does not leave the player loading', async () => {
    const native = driver();
    const player = new AudioPlayback(native.value);
    await assert.rejects(
        player.toggle(
            'voice',
            async () => {
                throw new Error('offline');
            },
            1000,
        ),
        /offline/,
    );
    assert.equal(player.getSnapshot().loading, false);
    await player.toggle('voice', async () => 'retry.m4a', 1000);
    assert.equal(player.getSnapshot().playing, true);
});
