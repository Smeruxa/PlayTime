import { useCallback, useEffect, useRef, useState } from 'react';

export function useResource<T>(loader: () => Promise<T>) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const generation = useRef(0);

    const reload = useCallback(async () => {
        const request = ++generation.current;
        setLoading(true);
        setError('');
        try {
            const result = await loader();
            if (request === generation.current) {
                setData(result);
            }
        } catch (reason) {
            if (request === generation.current) {
                setError(reason instanceof Error ? reason.message : 'Не удалось загрузить данные');
            }
        } finally {
            if (request === generation.current) {
                setLoading(false);
            }
        }
    }, [loader]);

    useEffect(() => {
        void reload();
        return () => {
            generation.current += 1;
        };
    }, [reload]);

    return { data, setData, loading, error, reload };
}
