import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Header, Notice } from '../../../ui/components';
import { RangeControl } from '../../../ui/components/RangeControl';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { pickImage } from '../../../platform/device';
import type { Wallpaper } from '../../../types';
import { WallpaperBackdrop } from '../components/WallpaperBackdrop';
import { wallpapers } from '../wallpapers';

export function WallpaperScreen() {
    const { state, client, back } = useApp();
    const [wallpaper, setWallpaper] = useState<Wallpaper>(state.wallpaper);
    const action = useAction();
    return (
        <View
            style={ui.page}
            testID="wallpaper-screen"
        >
            <Header
                title="Фон переписки"
                onBack={back}
            />
            <ScrollView contentContainerStyle={ui.content}>
                <View style={styles.preview}>
                    <WallpaperBackdrop wallpaper={wallpaper} />
                    <View style={styles.incoming}>
                        <Text style={ui.text}>Этот фон виден нам обоим?</Text>
                        <Text style={ui.caption}>12:40</Text>
                    </View>
                    <View style={styles.outgoing}>
                        <Text style={ui.text}>Да, это наш общий чат 💙</Text>
                        <Text style={ui.caption}>12:41 ✓✓</Text>
                    </View>
                </View>
                <Text style={ui.muted}>Изменения увидят оба участника переписки.</Text>
                <View style={styles.options}>
                    {wallpapers.map((preset) => (
                        <Pressable
                            key={preset.id}
                            accessibilityRole="radio"
                            accessibilityLabel={preset.title}
                            accessibilityState={{
                                checked: wallpaper.kind === 'preset' && wallpaper.id === preset.id,
                            }}
                            onPress={() => setWallpaper({ kind: 'preset', id: preset.id })}
                            style={[
                                styles.preset,
                                wallpaper.kind === 'preset' &&
                                    wallpaper.id === preset.id && { borderColor: colors.accent },
                            ]}
                        >
                            <WallpaperBackdrop wallpaper={{ kind: 'preset', id: preset.id }} />
                            <Text style={styles.presetName}>{preset.title}</Text>
                        </Pressable>
                    ))}
                </View>
                <Button
                    title="Выбрать своё изображение"
                    variant="secondary"
                    icon="image"
                    onPress={() =>
                        void action.run(async () => {
                            const image = await pickImage();
                            if (image) {
                                setWallpaper({
                                    kind: 'image',
                                    dataUrl: image.dataUri,
                                    dim: 38,
                                    blur: 0,
                                });
                            }
                        })
                    }
                />
                {wallpaper.kind === 'image' && (
                    <View style={ui.card}>
                        <RangeControl
                            label="Затемнение"
                            value={wallpaper.dim}
                            onChange={(dim) => setWallpaper({ ...wallpaper, dim })}
                        />
                        <RangeControl
                            label="Размытие"
                            value={wallpaper.blur}
                            onChange={(blur) => setWallpaper({ ...wallpaper, blur })}
                        />
                    </View>
                )}
                <Button
                    title="Без фона"
                    variant="ghost"
                    onPress={() => setWallpaper({ kind: 'none' })}
                />
                <Notice
                    text={action.error}
                    tone="error"
                />
                <Button
                    title="Применить фон"
                    testID="wallpaper-save"
                    busy={action.busy}
                    onPress={() =>
                        void action.run(async () => {
                            await client.setWallpaper(wallpaper);
                            back();
                        })
                    }
                />
            </ScrollView>
        </View>
    );
}
const styles = StyleSheet.create({
    preview: {
        borderRadius: 18,
        overflow: 'hidden',
        padding: 20,
        minHeight: 200,
        gap: 16,
        justifyContent: 'center',
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.border,
    },
    incoming: {
        alignSelf: 'flex-start',
        maxWidth: '90%',
        borderRadius: 15,
        backgroundColor: colors.surface,
        padding: 12,
        gap: 5,
    },
    outgoing: {
        alignSelf: 'flex-end',
        maxWidth: '90%',
        borderRadius: 15,
        backgroundColor: colors.outgoing,
        padding: 12,
        gap: 5,
    },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    preset: {
        width: '47%',
        minHeight: 86,
        borderRadius: 15,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: colors.border,
        justifyContent: 'flex-end',
        padding: 12,
    },
    presetName: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
