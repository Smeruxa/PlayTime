import { useCallback, useEffect, useRef, useState } from 'react';
import { preferencesStorage } from '../../../platform/preferencesStorage';

export function useChatDraft(key: string) {
    const [draft, updateDraft] = useState('');
    const [loaded, setLoaded] = useState(false);
    const current = useRef('');
    const changed = useRef(false);
    const mounted = useRef(true);

    const setDraft = useCallback((value: string) => {
        changed.current = true;
        current.current = value;
        updateDraft(value);
    }, []);

    useEffect(() => {
        mounted.current = true;
        changed.current = false;
        setLoaded(false);
        void preferencesStorage
            .getItem(key)
            .then((stored) => {
                if (mounted.current && !changed.current) {
                    current.current = stored || '';
                    updateDraft(current.current);
                }
            })
            .catch(() => undefined)
            .finally(() => {
                if (mounted.current) {
                    setLoaded(true);
                }
            });
        return () => {
            mounted.current = false;
            if (changed.current) {
                void preferencesStorage.setItem(key, current.current).catch(() => undefined);
            }
        };
    }, [key]);

    useEffect(() => {
        if (!loaded || !changed.current) {
            return;
        }
        const timer = setTimeout(() => {
            void preferencesStorage.setItem(key, draft).catch(() => undefined);
        }, 300);
        return () => clearTimeout(timer);
    }, [draft, key, loaded]);

    const clearDraft = useCallback(
        async (sentText: string) => {
            if (!mounted.current || current.current !== sentText) {
                return;
            }
            setDraft('');
            await preferencesStorage.removeItem(key);
        },
        [key, setDraft],
    );

    return { draft, setDraft, clearDraft };
}
