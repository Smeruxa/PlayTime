import { useCallback, useMemo, useState } from 'react';
import type { Message } from '../../../types';
import { searchMessages } from '../messageLayout';

export function useChatSearch(messages: readonly Message[]) {
    const [query, updateQuery] = useState('');
    const [selected, setSelected] = useState<number | null>(null);
    const results = useMemo(() => searchMessages(messages, query), [messages, query]);
    const selectedIndex = selected == null ? -1 : results.indexOf(selected);
    const index = selectedIndex < 0 ? results.length - 1 : selectedIndex;
    const setQuery = useCallback((value: string) => {
        updateQuery(value);
        setSelected(null);
    }, []);

    const move = (change: number) => {
        if (results.length) {
            setSelected(results[(index + change + results.length) % results.length]);
        }
    };

    return {
        query,
        setQuery,
        selectedId: results[index] ?? null,
        count: results.length,
        index,
        previous: () => move(-1),
        next: () => move(1),
    };
}
