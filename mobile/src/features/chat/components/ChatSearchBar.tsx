import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton, SearchField } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import type { useChatSearch } from '../hooks/useChatSearch';

type Props = { search: ReturnType<typeof useChatSearch>; onClose: () => void };

export function ChatSearchBar({ search, onClose }: Props) {
    return (
        <View style={styles.search}>
            <SearchField
                testID="history-search"
                value={search.query}
                onChangeText={search.setQuery}
                placeholder="Поиск в истории"
            />
            <View style={ui.row}>
                <Text
                    style={[ui.caption, ui.fill]}
                    accessibilityLiveRegion="polite"
                >
                    {search.query.trim()
                        ? search.count
                            ? `${search.index + 1} из ${search.count}`
                            : 'Совпадений нет'
                        : 'По загруженным сообщениям'}
                </Text>
                <IconButton
                    name="back"
                    label="Предыдущее совпадение"
                    disabled={!search.count}
                    onPress={search.previous}
                    testID="search-previous"
                />
                <IconButton
                    name="chevron"
                    label="Следующее совпадение"
                    disabled={!search.count}
                    onPress={search.next}
                    testID="search-next"
                />
                <IconButton
                    name="close"
                    label="Закрыть поиск"
                    onPress={onClose}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    search: { paddingHorizontal: 16, paddingTop: 8 },
});
