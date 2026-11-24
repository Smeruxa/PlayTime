import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RTCView, type MediaStream } from 'react-native-webrtc';
import { Icon } from '../../../ui/Icon';
import { colors } from '../../../ui/theme';
import { styles } from './styles';

export function CallScreenVideo({
    screen,
    fullscreen = false,
}: {
    screen: { username: string; stream: MediaStream };
    fullscreen?: boolean;
}) {
    return (
        <View style={[styles.videoFrame, fullscreen && { flex: 1, aspectRatio: undefined }]}>
            <RTCView
                testID={fullscreen ? 'call-screen-fullscreen-video' : 'call-screen-video'}
                streamURL={screen.stream.toURL()}
                objectFit="contain"
                mirror={false}
                style={StyleSheet.absoluteFill}
            />
            {!fullscreen && (
                <View style={styles.videoLabel}>
                    <Icon
                        name="monitor"
                        size={15}
                        color={colors.text}
                    />
                    <Text style={styles.videoLabelText}>{screen.username}</Text>
                </View>
            )}
        </View>
    );
}
