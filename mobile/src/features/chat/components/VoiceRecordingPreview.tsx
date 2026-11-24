import React from 'react';
import { View } from 'react-native';
import { Button } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import type { LocalMedia } from '../../../types';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';

type Props = {
    file: LocalMedia;
    busy: boolean;
    disabled?: boolean;
    onSend: () => void;
    onCancel: () => void;
};

export function VoiceRecordingPreview({ file, busy, disabled, onSend, onCancel }: Props) {
    return (
        <View
            style={ui.card}
            testID="voice-preview"
        >
            <VoiceMessagePlayer
                owner={`preview:${file.uri}`}
                load={() => Promise.resolve(file.uri)}
                durationSec={file.durationSec || 0}
                testID="voice-preview-play"
            />
            <View style={ui.row}>
                <View style={ui.fill}>
                    <Button
                        title="Отправить"
                        testID="voice-send"
                        busy={busy}
                        disabled={disabled}
                        onPress={onSend}
                    />
                </View>
                <Button
                    title="Удалить"
                    testID="voice-discard"
                    variant="ghost"
                    disabled={busy}
                    onPress={onCancel}
                />
            </View>
        </View>
    );
}
