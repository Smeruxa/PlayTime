import React, { forwardRef, type ComponentRef } from 'react';
import { StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { colors } from '../theme';
import { Icon } from '../Icon';
import { IconButton } from './IconButton';

type Props = {
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    testID?: string;
};

export const SearchField = forwardRef<ComponentRef<typeof TextInput>, Props>(
    function SearchFieldInput({ value, onChangeText, placeholder = 'Поиск', testID }, ref) {
        const { fontScale } = useWindowDimensions();
        const minHeight = Math.max(48, Math.ceil(22 * fontScale + 20));
        return (
            <View style={s.search}>
                <Icon
                    name="search"
                    size={19}
                    color={colors.muted}
                />
                <TextInput
                    ref={ref}
                    testID={testID}
                    accessibilityLabel={placeholder}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={colors.subtle}
                    selectionColor={colors.accent}
                    returnKeyType="search"
                    disableFullscreenUI
                    style={[s.searchInput, { minHeight }]}
                />
                {value ? (
                    <IconButton
                        name="close"
                        label="Очистить поиск"
                        onPress={() => onChangeText('')}
                    />
                ) : null}
            </View>
        );
    },
);

const s = StyleSheet.create({
    search: {
        backgroundColor: colors.surface,
        borderRadius: 14,
        paddingLeft: 15,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        minHeight: 48,
    },
    searchInput: {
        flex: 1,
        color: colors.text,
        fontSize: 15,
        paddingVertical: 10,
        paddingRight: 12,
    },
});
