import { useCallback, useEffect, useRef, useState } from 'react';
import { preferencesStorage } from '../../../platform/preferencesStorage';
import { EMOJI_CATALOG } from '../emojiCatalog';

const allowed = new Set(EMOJI_CATALOG);

export function useFrequentEmoji(userId: number) {
    const key = `emoji-usage:${userId}`;
    const [counts, setCounts] = useState<Record<string, number>>({});
    const current = useRef<Record<string, number>>({});
    const changed = useRef(false);

    useEffect(() => {
        let mounted = true;
        void preferencesStorage
            .getItem(key)
            .then((saved) => {
                if (!saved || !mounted || changed.current) {
                    return;
                }
                const value: unknown = JSON.parse(saved);
                if (value && typeof value === 'object') {
                    const valid = Object.entries(value).filter(
                        ([emoji, count]) =>
                            allowed.has(emoji) &&
                            typeof count === 'number' &&
                            Number.isSafeInteger(count) &&
                            count > 0,
                    );
                    current.current = Object.fromEntries(valid);
                    setCounts(current.current);
                }
            })
            .catch(() => undefined);
        return () => {
            mounted = false;
        };
    }, [key]);

    const record = useCallback(
        (emoji: string) => {
            changed.current = true;
            const next = { ...current.current, [emoji]: (current.current[emoji] || 0) + 1 };
            current.current = next;
            setCounts(next);
            void preferencesStorage.setItem(key, JSON.stringify(next)).catch(() => undefined);
        },
        [key],
    );

    return {
        frequent: Object.keys(counts)
            .sort((a, b) => counts[b] - counts[a])
            .slice(0, 30),
        record,
    };
}
