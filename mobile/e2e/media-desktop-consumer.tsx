import React from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceMessagePlayer } from '../../apps/frontend/src/features/chat/components/VoiceMessagePlayer';
import { ChatAttachmentBubble } from '../../apps/frontend/src/features/chat/components/ChatAttachmentBubble';
import type { MediaDescriptor } from '../../apps/frontend/src/features/chat/mediaEncryption';

declare global {
    interface Window {
        nativeMediaInput: {
            token: string;
            items: { id: number; descriptor: MediaDescriptor; plaintextSha256: string }[];
        };
        mediaInteropResult?: { status: string; results?: unknown[]; error?: string };
    }
}
const input = window.nativeMediaInput;
localStorage.setItem('token', input.token);
createRoot(document.getElementById('root')!).render(
    <main>
        <h1>Native Android → unchanged desktop consumers</h1>
        {input.items.map(({ id, descriptor: media }) => (
            <section
                key={id}
                data-message={id}
            >
                <h2>
                    {media.kind}: {media.filename}
                </h2>
                {media.kind === 'voice' ? (
                    <VoiceMessagePlayer
                        voiceKey={media.storageKey}
                        durationSec={media.durationSec!}
                        mine={false}
                        media={media}
                    />
                ) : (
                    <ChatAttachmentBubble
                        attachmentKey={media.storageKey}
                        mime={media.mime}
                        filename={media.filename}
                        sizeBytes={media.sizeBytes}
                        mine={false}
                        media={media}
                    />
                )}
            </section>
        ))}
    </main>,
);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, description: string) {
    for (let index = 0; index < 150; index++) {
        if (check()) return;
        await wait(100);
    }
    throw new Error(description);
}
async function hash(bytes: ArrayBuffer) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
        b.toString(16).padStart(2, '0'),
    ).join('');
}
async function inspect() {
    const results = [];
    for (const item of input.items) {
        await until(
            () => Boolean(document.querySelector(`[data-message="${item.id}"]`)),
            'React consumer did not mount',
        );
        const section = document.querySelector(`[data-message="${item.id}"]`)!;
        const media = item.descriptor;
        if (media.kind === 'voice') {
            await until(
                () => Boolean(section.querySelector('audio')?.src),
                'Desktop voice did not load',
            );
            const audio = section.querySelector('audio')!;
            await until(
                () => Number.isFinite(audio.duration) && audio.duration > 0,
                'Chromium did not decode native voice',
            );
            const button = section.querySelector('button')!;
            button.click();
            await until(
                () => audio.currentTime > 0.7 && !audio.paused,
                'Desktop player did not progress',
            );
            const result = {
                id: item.id,
                kind: 'voice',
                duration: audio.duration,
                currentTime: audio.currentTime,
                pausedDuringPlayback: audio.paused,
                readyState: audio.readyState,
                mime: media.mime,
                sha256: await hash(await (await fetch(audio.src)).arrayBuffer()),
            };
            button.click();
            await wait(100);
            if (!audio.paused) throw new Error('Desktop voice pause button failed');
            results.push({ ...result, pauseButtonWorks: true });
        } else {
            await until(
                () => Boolean(section.querySelector('a')?.href?.startsWith('blob:')),
                'Desktop attachment did not load',
            );
            const link = section.querySelector('a')!;
            const image = section.querySelector('img');
            if (image)
                await until(
                    () => image.complete && image.naturalWidth > 0,
                    'Chromium image decoder failed',
                );
            results.push({
                id: item.id,
                kind: 'attachment',
                mime: media.mime,
                filename: media.filename,
                width: image?.naturalWidth,
                height: image?.naturalHeight,
                sha256: await hash(await (await fetch(link.href)).arrayBuffer()),
            });
        }
    }
    for (const result of results) {
        if (result.sha256 !== input.items.find((item) => item.id === result.id)!.plaintextSha256)
            throw new Error('Consumer bytes differ from desktop decryption');
    }
    window.mediaInteropResult = { status: 'passed', results };
}
void inspect().catch((error: unknown) => {
    window.mediaInteropResult = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
    };
});
