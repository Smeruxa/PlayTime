import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CallController } from '../CallController';
import { Button, IconButton } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import { CallAudioRoutes } from './CallAudioRoutes';
import { VolumeControl } from './VolumeControl';
import { styles } from './styles';

export function CallVolumeSheet({
    controller,
    visible,
    label,
    value,
    audioRoutes,
    onChange,
    onClose,
}: {
    controller: CallController;
    visible: boolean;
    label: string;
    value: number;
    audioRoutes: boolean;
    onChange: (value: number) => void;
    onClose: () => void;
}) {
    const insets = useSafeAreaInsets();
    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
            statusBarTranslucent
            navigationBarTranslucent
        >
            <View style={styles.backdrop}>
                <Pressable
                    style={StyleSheet.absoluteFill}
                    accessibilityLabel="Закрыть настройку громкости"
                    onPress={onClose}
                />
                <View
                    style={[
                        styles.sheet,
                        { paddingBottom: Math.max(insets.bottom, 20), paddingTop: 22 },
                    ]}
                >
                    <ScrollView
                        style={{ flexShrink: 1 }}
                        contentContainerStyle={ui.stack}
                    >
                        <View style={ui.between}>
                            <Text style={ui.heading}>Громкость</Text>
                            <IconButton
                                name="close"
                                label="Закрыть"
                                onPress={onClose}
                            />
                        </View>
                        <VolumeControl
                            label={label}
                            value={value}
                            onChange={onChange}
                            testID="call-volume-control"
                        />
                        <Text style={ui.caption}>
                            Эту настройку слышите только вы. Кнопки громкости телефона управляют
                            общим уровнем звука.
                        </Text>
                        {audioRoutes && <CallAudioRoutes controller={controller} />}
                        <Button
                            title="Готово"
                            testID="call-volume-done"
                            onPress={onClose}
                        />
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}
