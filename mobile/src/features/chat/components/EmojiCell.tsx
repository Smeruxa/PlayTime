import React, { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

export const EMOJI_ROW_HEIGHT = 48;

type Props = {
    emoji: string;
    width: number;
    onPick: (emoji: string) => void;
};

export const EmojiCell = memo(function EmojiCellView({ emoji, width, onPick }: Props) {
    return (
        <Pressable
            testID={`emoji-cell-${emoji}`}
            accessibilityRole="button"
            accessibilityLabel={`Вставить ${emoji}`}
            onPress={() => onPick(emoji)}
            style={[styles.cell, { width }]}
        >
            <Text
                allowFontScaling={false}
                style={styles.emoji}
            >
                {emoji}
            </Text>
        </Pressable>
    );
});

const styles = StyleSheet.create({
    cell: { height: EMOJI_ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
    emoji: { fontSize: 26 },
});
