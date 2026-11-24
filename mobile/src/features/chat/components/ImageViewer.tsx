import React, { useState } from 'react';
import { Image, Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';
import { useImageTransform } from '../hooks/useImageTransform';

type Props = { uri: string; filename: string; onClose: () => void; onShare: () => void };

export function ImageViewer({ uri, filename, onClose, onShare }: Props) {
    const [size, setSize] = useState({ width: 1, height: 1 });
    const { transform, handlers, zoom, reset } = useImageTransform(size.width, size.height);
    return (
        <Modal
            visible
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent
            navigationBarTranslucent
        >
            <SafeAreaView style={styles.page}>
                <View style={styles.toolbar}>
                    <IconButton
                        name="close"
                        label="Закрыть изображение"
                        onPress={onClose}
                    />
                    <Text
                        style={[ui.text, ui.fill]}
                        numberOfLines={1}
                    >
                        {filename}
                    </Text>
                    <IconButton
                        name="search"
                        label={
                            transform.scale > 1 ? 'Уменьшить изображение' : 'Увеличить изображение'
                        }
                        onPress={zoom}
                    />
                    <IconButton
                        name="upload"
                        label="Поделиться изображением"
                        onPress={onShare}
                    />
                </View>
                <View
                    style={styles.viewport}
                    onLayout={(event) => {
                        const { width, height } = event.nativeEvent.layout;
                        setSize({ width, height });
                        reset();
                    }}
                    {...handlers}
                >
                    <Image
                        accessibilityLabel={filename}
                        source={{ uri }}
                        resizeMode="contain"
                        style={[
                            styles.image,
                            {
                                transform: [
                                    { translateX: transform.x },
                                    { translateY: transform.y },
                                    { scale: transform.scale },
                                ],
                            },
                        ]}
                    />
                </View>
                <Text style={styles.hint}>
                    Разведите два пальца или нажмите дважды для увеличения
                </Text>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
    viewport: { flex: 1, overflow: 'hidden' },
    image: { width: '100%', height: '100%' },
    hint: { color: colors.muted, fontSize: 12, textAlign: 'center', padding: 16 },
});
