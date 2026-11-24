import { AppState, NativeEventEmitter } from 'react-native';
import { AudioPlayback } from './PlaybackController';
import { native } from './NativePlayTime';

export const audioPlayback = new AudioPlayback(native);

let subscribers = 0;
let release: (() => void) | undefined;

export function subscribeAudio(listener: () => void): () => void {
    const unsubscribe = audioPlayback.subscribe(listener);
    if (subscribers++ === 0) {
        const events = new NativeEventEmitter(native);
        const ended = events.addListener('PlayTimeAudioEnded', (event: { error?: string }) =>
            audioPlayback.ended(event.error),
        );
        const stopped = events.addListener('PlayTimeAudioStopped', () => {
            void audioPlayback.stop().catch(() => undefined);
        });
        const paused = events.addListener('PlayTimeAudioPaused', () => audioPlayback.interrupted());
        const appState = AppState.addEventListener('change', (next) => {
            if (next !== 'active') {
                void audioPlayback.stop().catch(() => undefined);
            }
        });
        const timer = setInterval(() => void audioPlayback.poll(), 250);
        release = () => {
            clearInterval(timer);
            ended.remove();
            paused.remove();
            stopped.remove();
            appState.remove();
        };
    }
    return () => {
        unsubscribe();
        if (--subscribers === 0) {
            release?.();
            release = undefined;
            void audioPlayback.stop().catch(() => undefined);
        }
    };
}
