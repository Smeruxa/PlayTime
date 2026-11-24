import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Image } from 'react-native';
import { AttachmentMessage } from '../src/features/chat/components/AttachmentMessage';
import { useApp } from '../src/state/AppContext';
import type { MediaDescriptor } from '../src/types';

jest.mock('../src/state/AppContext', () => ({ useApp: jest.fn() }));
jest.mock('../src/platform/device', () => ({ native: {} }));
jest.mock('../src/ui/components', () => ({ Button: 'Button', Notice: 'Notice' }));
jest.mock('../src/ui/Icon', () => ({ Icon: 'Icon' }));

test('history refresh during image download retains the latest preview subscription', async () => {
    let complete!: (uri: string) => void;
    const pending = new Promise<string>((resolve) => {
        complete = resolve;
    });
    const downloadMedia = jest.fn(() => pending);
    jest.mocked(useApp).mockReturnValue({ client: { downloadMedia } } as unknown as ReturnType<
        typeof useApp
    >);
    const media = {
        kind: 'attachment',
        storageKey: 'image-key',
        mime: 'image/png',
        filename: 'test.png',
        sizeBytes: 10,
    } as MediaDescriptor;
    const element = (descriptor: MediaDescriptor) =>
        React.createElement(AttachmentMessage, {
            media: descriptor,
            mime: descriptor.mime,
            filename: descriptor.filename,
            sizeBytes: descriptor.sizeBytes,
        });
    let renderer!: ReactTestRenderer;
    try {
        await act(async () => {
            renderer = create(element(media));
        });
        await act(async () => {
            renderer.update(element({ ...media }));
        });
        await act(async () => {
            complete('file:///decrypted-image.png');
            await pending;
        });
        expect(downloadMedia).toHaveBeenCalledTimes(1);
        expect(renderer.root.findByType(Image).props.source).toEqual({
            uri: 'file:///decrypted-image.png',
        });
    } finally {
        await act(async () => renderer?.unmount());
    }
});
