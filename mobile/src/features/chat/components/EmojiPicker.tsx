import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { Button, IconButton } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { EMOJI_CATALOG } from '../emojiCatalog';
import { useFrequentEmoji } from '../hooks/useFrequentEmoji';
import { EmojiCell, EMOJI_ROW_HEIGHT } from './EmojiCell';

type Props = { onPick: (emoji: string) => void; onClose: () => void };
const GRID_PADDING = 8;
const emojiKey = (emoji: string) => emoji;
const rowLayout = (_data: ArrayLike<string> | null | undefined, row: number) => ({
    length: EMOJI_ROW_HEIGHT,
    offset: EMOJI_ROW_HEIGHT * row,
    index: row,
});

export function EmojiPicker({ onPick, onClose }: Props) {
    const { state } = useApp();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const [width, setWidth] = useState(windowWidth);
    const [showFrequent, setShowFrequent] = useState(false);
    const { frequent, record } = useFrequentEmoji(state.session?.user.id || 0);
    const columns = Math.max(1, Math.floor((width - GRID_PADDING * 2) / EMOJI_ROW_HEIGHT));
    const cellWidth = (width - GRID_PADDING * 2) / columns;
    const height = Math.min(320, Math.max(144, windowHeight * 0.45));

    const pick = useCallback(
        (emoji: string) => {
            record(emoji);
            onPick(emoji);
        },
        [onPick, record],
    );
    const renderEmoji = useCallback(
        ({ item }: ListRenderItemInfo<string>) => (
            <EmojiCell
                emoji={item}
                width={cellWidth}
                onPick={pick}
            />
        ),
        [cellWidth, pick],
    );

    return (
        <View
            style={[styles.picker, { height }]}
            testID="emoji-picker"
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
            <View style={styles.header}>
                <Button
                    title="Все"
                    variant={showFrequent ? 'ghost' : 'secondary'}
                    onPress={() => setShowFrequent(false)}
                />
                <Button
                    title="Частые"
                    variant={showFrequent ? 'secondary' : 'ghost'}
                    onPress={() => setShowFrequent(true)}
                />
                <View style={ui.fill} />
                <IconButton
                    name="close"
                    label="Закрыть эмодзи"
                    onPress={onClose}
                />
            </View>
            <FlatList
                key={`${showFrequent ? 'frequent' : 'all'}:${columns}`}
                testID="emoji-list"
                style={ui.fill}
                contentContainerStyle={styles.grid}
                data={showFrequent ? frequent : EMOJI_CATALOG}
                numColumns={columns}
                keyExtractor={emojiKey}
                renderItem={renderEmoji}
                getItemLayout={rowLayout}
                initialNumToRender={6}
                maxToRenderPerBatch={4}
                updateCellsBatchingPeriod={32}
                windowSize={3}
                removeClippedSubviews
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                    <Text style={[ui.caption, styles.empty]}>
                        Здесь появятся эмодзи, которыми вы пользуетесь чаще всего.
                    </Text>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    picker: {
        backgroundColor: colors.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
    },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
    grid: { paddingHorizontal: GRID_PADDING, paddingBottom: 6 },
    empty: { padding: 12 },
});
