import { useCallback, useRef } from 'react';
import { useApp } from '../../../state/AppContext';
import type { MediaDescriptor } from '../../../types';

export function useMediaDownload(media?: MediaDescriptor) {
    const { client } = useApp();
    const cached = useRef<{ key: string; uri: Promise<string> } | null>(null);

    return useCallback(async () => {
        if (!media) {
            throw new Error('Вложение недоступно: отсутствует ключ файла');
        }
        if (cached.current?.key !== media.storageKey) {
            const uri = client.downloadMedia(media);
            cached.current = { key: media.storageKey, uri };
            void uri.catch(() => {
                if (cached.current?.uri === uri) {
                    cached.current = null;
                }
            });
        }
        return cached.current.uri;
    }, [client, media]);
}
