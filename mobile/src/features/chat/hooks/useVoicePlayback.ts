import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { audioPlayback, subscribeAudio } from '../../../platform/audioSession';
import { useAction } from '../../../state/useAction';

const inactive = {
    owner: null,
    playing: false,
    loading: false,
    positionMs: 0,
    durationMs: 0,
    error: '',
};

export function useVoicePlayback(owner: string, load: () => Promise<string>, durationSec: number) {
    const getSnapshot = useCallback(() => {
        const snapshot = audioPlayback.getSnapshot();
        return snapshot.owner === owner ? snapshot : inactive;
    }, [owner]);
    const state = useSyncExternalStore(subscribeAudio, getSnapshot);
    const action = useAction();

    useEffect(
        () => () => {
            void audioPlayback.stop(owner).catch(() => undefined);
        },
        [owner],
    );

    return {
        ...state,
        durationMs: state.durationMs || durationSec * 1000,
        loading: state.loading || action.busy,
        error: action.error || state.error,
        toggle: () => action.run(() => audioPlayback.toggle(owner, load, durationSec * 1000)),
        seek: (fraction: number) => action.run(() => audioPlayback.seek(owner, fraction)),
    };
}
