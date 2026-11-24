import { useCallback, useEffect, useRef, type ComponentRef } from 'react';
import type { ScrollView } from 'react-native';

export function useAuthErrorReveal(error: string) {
    const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
    const pending = useRef(false);
    const revealError = useCallback(() => {
        if (!pending.current) {
            return;
        }
        pending.current = false;
        scroll.current?.scrollToEnd({ animated: true });
    }, []);

    useEffect(() => {
        pending.current = Boolean(error);
        if (!error) {
            return;
        }
        const timer = setTimeout(revealError, 80);
        return () => clearTimeout(timer);
    }, [error, revealError]);

    return { scroll, revealError };
}
