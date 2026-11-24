import { useSyncExternalStore } from 'react';
import type { PushStatus } from '../services/pushRegistration';

let status: PushStatus = 'disabled';
const listeners = new Set<() => void>();

export function publishPushStatus(next: PushStatus): void {
    if (next !== status) {
        status = next;
        listeners.forEach((listener) => listener());
    }
}

export function usePushStatus(): PushStatus {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => status,
    );
}

export function pushStatusLabel(value: PushStatus): string {
    switch (value) {
        case 'ready':
            return 'Уведомления приходят и после закрытия приложения.';
        case 'unavailable':
            return 'Уведомления после закрытия приложения недоступны в этой сборке.';
        case 'retrying':
            return 'Уведомления после закрытия приложения подключатся при восстановлении связи.';
        case 'checking':
            return 'Проверяем уведомления после закрытия приложения…';
        case 'disabled':
            return 'Уведомления отключены.';
    }
}
