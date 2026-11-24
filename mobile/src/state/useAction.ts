import { useCallback, useRef, useState, useEffect } from 'react';

export function useAction() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const lock = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const run = useCallback(async (operation: () => Promise<unknown>, successMessage = '') => {
        if (lock.current) {
            return false;
        }
        lock.current = true;
        setBusy(true);
        setError('');
        setSuccess('');
        try {
            await operation();
            if (mounted.current) {
                setSuccess(successMessage);
            }
            return true;
        } catch (reason) {
            if (mounted.current) {
                setError(
                    reason instanceof Error
                        ? reason.message
                        : 'Не удалось выполнить действие. Повторите попытку.',
                );
            }
            return false;
        } finally {
            lock.current = false;
            if (mounted.current) {
                setBusy(false);
            }
        }
    }, []);
    return { busy, error, success, run, setError, setSuccess };
}
