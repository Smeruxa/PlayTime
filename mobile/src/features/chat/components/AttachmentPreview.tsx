import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { formatBytes } from '../../../state/validation';
import type { LocalMedia } from '../../../types';

type Props = {
    file: LocalMedia;
    busy: boolean;
    disabled?: boolean;
    onSend: () => void;
    onCancel: () => void;
};

export function AttachmentPreview({ file, busy, disabled, onSend, onCancel }: Props) {
    return (
        <View
            style={ui.card}
            testID="attachment-preview"
        >
            <View style={ui.row}>
                {file.mime.startsWith('image/') ? (
                    <Image
                        source={{ uri: file.uri }}
                        style={styles.thumbnail}
                    />
                ) : (
                    <Icon
                        name="file"
                        color={colors.accent}
                    />
                )}
                <View style={ui.fill}>
                    <Text
                        style={ui.text}
                        numberOfLines={2}
                    >
                        {file.name}
                    </Text>
                    <Text style={ui.caption}>{formatBytes(file.size)}</Text>
                </View>
            </View>
            <View style={ui.row}>
                <View style={ui.fill}>
                    <Button
                        title="Отправить файл"
                        testID="attachment-send"
                        busy={busy}
                        disabled={disabled}
                        onPress={onSend}
                    />
                </View>
                <Button
                    title="Отмена"
                    testID="attachment-cancel"
                    variant="ghost"
                    disabled={busy}
                    onPress={onCancel}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    thumbnail: { width: 52, height: 52, borderRadius: 8 },
});
