import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, NativeEventEmitter } from 'react-native';
import { microphonePermission, native } from '../device';
import { audioPlayback } from '../audioSession';
import { useAction } from '../../state/useAction';
import type { LocalMedia } from '../../types';

type Options = {
    maxDuration: number;
    inCall: boolean;
    onSend: (file: LocalMedia) => Promise<void>;
};

export function useAudioRecording({ maxDuration, inCall, onSend }: Options) {
    const [recording, setRecording] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [level, setLevel] = useState(0);
    const [pending, setPending] = useState<LocalMedia | null>(null);
    const active = useRef(false);
    const mounted = useRef(true);
    const pendingRef = useRef<LocalMedia | null>(null);
    const started = useRef(0);
    const action = useAction();
    const { run, setError } = action;

    const finishRecording = useCallback(async (): Promise<LocalMedia | null> => {
        if (!active.current) {
            return pendingRef.current;
        }
        active.current = false;
        setRecording(false);
        setLevel(0);
        const recorded = await native.stopVoiceRecording();
        const file = { ...recorded, durationSec: recorded.durationMs / 1000 };
        pendingRef.current = file;
        if (mounted.current) {
            setPending(file);
        }
        return file;
    }, []);

    const cancel = useCallback(async () => {
        active.current = false;
        setRecording(false);
        setLevel(0);
        const file = pendingRef.current;
        pendingRef.current = null;
        setPending(null);
        await audioPlayback.stop();
        await native.cancelVoiceRecording();
        if (file) {
            await native.deleteCacheFile(file.uri).catch(() => undefined);
        }
    }, []);

    const start = useCallback(
        () =>
            run(async () => {
                if (inCall) {
                    throw new Error('Завершите звонок перед записью голосового сообщения');
                }
                if (!(await microphonePermission())) {
                    throw new Error('Для голосового сообщения нужен доступ к микрофону');
                }
                if (!mounted.current) {
                    return;
                }
                Keyboard.dismiss();
                await audioPlayback.stop();
                await native.startVoiceRecordingWithLimit(maxDuration);
                if (!mounted.current) {
                    await native.cancelVoiceRecording();
                    return;
                }
                active.current = true;
                started.current = Date.now();
                setRecording(true);
                setElapsed(0);
                setLevel(0);
                pendingRef.current = null;
                setPending(null);
            }),
        [inCall, maxDuration, run],
    );

    const stop = useCallback(() => run(finishRecording), [finishRecording, run]);
    const send = useCallback(
        () =>
            run(async () => {
                const file = await finishRecording();
                if (!file) {
                    return;
                }
                await audioPlayback.stop();
                await onSend(file);
                pendingRef.current = null;
                if (mounted.current) {
                    setPending(null);
                }
                await native.deleteCacheFile(file.uri).catch(() => undefined);
            }),
        [finishRecording, onSend, run],
    );

    useEffect(() => {
        if (!recording) {
            return;
        }
        const timer = setInterval(() => {
            setElapsed(Math.min(maxDuration, Math.floor((Date.now() - started.current) / 1000)));
        }, 250);
        return () => clearInterval(timer);
    }, [recording, maxDuration]);

    useEffect(() => {
        const interrupt = () => {
            if (active.current) {
                void cancel().catch(() => undefined);
                setError('Запись прервана. Запишите сообщение ещё раз.');
            }
        };
        mounted.current = true;
        const appState = AppState.addEventListener('change', (next) => {
            if (next !== 'active') {
                interrupt();
            }
        });
        const events = new NativeEventEmitter(native);
        const nativeInterrupt = events.addListener('PlayTimeRecordingInterrupted', interrupt);
        const levels = events.addListener(
            'PlayTimeRecordingLevel',
            (event: { level?: unknown }) => {
                if (
                    active.current &&
                    mounted.current &&
                    typeof event.level === 'number' &&
                    Number.isFinite(event.level)
                ) {
                    setLevel(Math.max(0, Math.min(1, event.level)));
                }
            },
        );
        const limit = events.addListener('PlayTimeRecordingLimit', () => {
            void stop();
        });
        return () => {
            mounted.current = false;
            appState.remove();
            nativeInterrupt.remove();
            levels.remove();
            limit.remove();
            if (active.current) {
                active.current = false;
                void native.cancelVoiceRecording().catch(() => undefined);
            }
        };
    }, [cancel, setError, stop]);

    return { recording, elapsed, level, pending, start, stop, send, cancel, ...action };
}
