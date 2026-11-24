import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton, Notice } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';
import { useVoicePlayback } from '../hooks/useVoicePlayback';
import { PlaybackProgress } from './PlaybackProgress';

type Props = {
    owner: string;
    load: () => Promise<string>;
    durationSec: number;
    testID?: string;
};

function time(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function VoiceMessagePlayer({ owner, load, durationSec, testID }: Props) {
    const playback = useVoicePlayback(owner, load, durationSec);
    return (
        <View style={styles.player}>
            <View style={ui.row}>
                <IconButton
                    testID={testID || `voice-play-${owner}`}
                    name={playback.playing ? 'pause' : 'play'}
                    label={playback.playing ? 'Приостановить голосовое' : 'Прослушать голосовое'}
                    disabled={playback.loading}
                    onPress={() => void playback.toggle()}
                    color={colors.accent}
                />
                <View style={ui.fill}>
                    <Text style={ui.caption}>
                        {playback.loading ? 'Загружаем запись…' : 'Голосовое сообщение'}
                    </Text>
                    <PlaybackProgress
                        positionMs={playback.positionMs}
                        durationMs={playback.durationMs}
                        disabled={!playback.owner || playback.loading}
                        onSeek={(fraction) => void playback.seek(fraction)}
                    />
                    <Text style={ui.caption}>
                        {time(playback.positionMs)} / {time(playback.durationMs)}
                    </Text>
                </View>
            </View>
            <Notice
                text={playback.error}
                tone="error"
            />
        </View>
    );
}

const styles = StyleSheet.create({
    player: { minWidth: 220, maxWidth: '100%', paddingVertical: 5 },
});
