import { useState } from 'react';
import { Keyboard } from 'react-native';
import { native, pickFile } from '../../../platform/device';
import { useAction } from '../../../state/useAction';
import { formatBytes } from '../../../state/validation';
import type { LocalMedia } from '../../../types';

type Options = {
    maxBytes: number;
    onSend: (file: LocalMedia) => Promise<void>;
};

export function useAttachmentComposer({ maxBytes, onSend }: Options) {
    const [file, setFile] = useState<LocalMedia | null>(null);
    const action = useAction();

    const pick = () =>
        action.run(async () => {
            Keyboard.dismiss();
            const selected = await pickFile();
            if (!selected) {
                return;
            }
            if (selected.size <= 0 || selected.size > maxBytes) {
                await native.deleteCacheFile(selected.uri).catch(() => undefined);
                throw new Error(
                    `Размер файла — от 1 байта до ${formatBytes(maxBytes)} для вашего плана`,
                );
            }
            setFile(selected);
        });

    const send = () =>
        action.run(async () => {
            if (!file) {
                return;
            }
            await onSend(file);
            setFile(null);
            await native.deleteCacheFile(file.uri).catch(() => undefined);
        });

    const cancel = () =>
        action.run(async () => {
            const selected = file;
            setFile(null);
            if (selected) {
                await native.deleteCacheFile(selected.uri).catch(() => undefined);
            }
        });

    return { file, pick, send, cancel, ...action };
}
