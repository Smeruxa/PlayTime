import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Avatar, Button, Field, Header, Notice } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';

export function CreateRoomScreen() {
    const { client, back, openChat, state } = useApp();
    const [name, setName] = useState('');
    const action = useAction();
    return (
        <View
            style={ui.page}
            testID="create-room-screen"
        >
            <Header
                title="Новая комната"
                onBack={back}
            />
            <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={ui.content}
            >
                <View
                    style={[
                        ui.card,
                        { alignItems: 'center', paddingVertical: 32, backgroundColor: '#1B2B2B' },
                    ]}
                >
                    <Avatar
                        name="Комната"
                        size={96}
                        room
                    />
                    <Text style={[ui.title, { marginTop: 4 }]}>Место для своих</Text>
                    <Text style={[ui.muted, { textAlign: 'center' }]}>
                        Общий чат, голос и демонстрация экрана. Пригласите друзей после создания.
                    </Text>
                </View>
                <Field
                    label="Название комнаты"
                    testID="room-name"
                    placeholder="Например, Вечерний чат"
                    value={name}
                    onChangeText={setName}
                    maxLength={15}
                    hint={`${name.length}/15 · от 3 символов`}
                    editable={!action.busy}
                />
                <Notice
                    text={action.error}
                    tone="error"
                />
                <Button
                    testID="room-create"
                    title="Создать комнату"
                    icon="plus"
                    busy={action.busy}
                    onPress={() =>
                        void action.run(async () => {
                            if (name.trim().length < 3) {
                                throw new Error('Название — от 3 до 15 символов');
                            }
                            const chat = await client.createRoom(name.trim());
                            openChat(chat);
                        })
                    }
                />
                <View style={ui.row}>
                    <Icon
                        name="people"
                        color={colors.muted}
                        size={17}
                    />
                    <Text style={ui.caption}>
                        До {state.subscription?.limits.maxRoomMembers || '…'} участников в вашем
                        плане
                    </Text>
                </View>
            </ScrollView>
        </View>
    );
}
