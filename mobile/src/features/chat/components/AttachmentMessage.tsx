import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Notice } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { native } from '../../../platform/device';
import { useAction } from '../../../state/useAction';
import { formatBytes } from '../../../state/validation';
import type { MediaDescriptor } from '../../../types';
import { useMediaDownload } from '../hooks/useMediaDownload';
import { ImageViewer } from './ImageViewer';

type Props = { media?: MediaDescriptor; filename: string; sizeBytes: number; mime: string };

export function AttachmentMessage({ media, filename, sizeBytes, mime }: Props) {
    const load = useMediaDownload(media);
    const [uri, setUri] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [imageLoading, setImageLoading] = useState(false);
    const action = useAction();
    const isImage = mime.startsWith('image/');
    const { setError } = action;
    const busy = action.busy || imageLoading;

    useEffect(() => {
        setUri(null);
        setImageLoading(isImage);
        if (!isImage) {
            return;
        }
        let mounted = true;
        setError('');
        void load()
            .then((local) => {
                if (mounted) {
                    setUri(local);
                }
            })
            .catch((reason: unknown) => {
                if (mounted) {
                    setError(
                        reason instanceof Error
                            ? reason.message
                            : 'Не удалось открыть изображение.',
                    );
                }
            })
            .finally(() => {
                if (mounted) {
                    setImageLoading(false);
                }
            });
        return () => {
            mounted = false;
        };
    }, [isImage, load, setError]);

    const share = () =>
        action.run(async () => {
            await native.shareFile(uri || (await load()), mime);
        });
    const open = () =>
        action.run(async () => {
            const local = uri || (await load());
            setUri(local);
            if (isImage) {
                setExpanded(true);
            } else {
                await native.shareFile(local, mime);
            }
        });
    const save = () =>
        action.run(async () => {
            const local = uri || (await load());
            const bytes = await native.readFile(local);
            await native.saveDocument(filename, bytes, mime);
        });

    return (
        <View style={styles.attachment}>
            <Pressable
                onPress={() => void open()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Открыть вложение ${filename}`}
            >
                {isImage && uri ? (
                    <Image
                        testID="attachment-inline-image"
                        accessibilityLabel={`Изображение ${filename}`}
                        source={{ uri }}
                        style={styles.image}
                        resizeMode="cover"
                    />
                ) : (
                    <View style={styles.file}>
                        <Icon
                            name={isImage ? 'image' : 'file'}
                            color={colors.accent}
                        />
                        <View style={ui.fill}>
                            <Text
                                style={ui.text}
                                numberOfLines={2}
                            >
                                {filename}
                            </Text>
                            <Text style={ui.caption}>
                                {busy ? 'Загружаем…' : formatBytes(sizeBytes)}
                            </Text>
                        </View>
                    </View>
                )}
            </Pressable>
            <View style={styles.actions}>
                <Button
                    title="Сохранить"
                    variant="ghost"
                    busy={busy}
                    onPress={() => void save()}
                />
                <Button
                    title="Поделиться"
                    variant="ghost"
                    disabled={busy}
                    onPress={() => void share()}
                />
            </View>
            <Notice
                text={action.error}
                tone="error"
            />
            {expanded && uri && (
                <ImageViewer
                    uri={uri}
                    filename={filename}
                    onClose={() => setExpanded(false)}
                    onShare={() => void share()}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    actions: { alignSelf: 'stretch', gap: 2 },
    attachment: { minWidth: 220, maxWidth: '100%', paddingVertical: 5 },
    image: { width: 240, maxWidth: '100%', height: 180, borderRadius: 10 },
    file: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
});
