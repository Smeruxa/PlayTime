import React, { useCallback } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Avatar, Button, Empty, Header, Loading, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useResource } from '../../../state/useResource';
import { useAction } from '../../../state/useAction';
import { confirm } from '../../../platform/device';

export function BlockedUsersScreen() {
    const { client, back } = useApp();
    const loader = useCallback(() => client.blockedUsers(), [client]);
    const resource = useResource(loader);
    const action = useAction();
    return (
        <View
            style={ui.page}
            testID="blocked-users-screen"
        >
            <Header
                title="Заблокированные"
                onBack={back}
            />
            <ScrollView contentContainerStyle={ui.content}>
                <Notice
                    text={resource.error || action.error}
                    tone="error"
                />
                {resource.loading ? (
                    <Loading />
                ) : resource.data?.length ? (
                    resource.data.map((username) => (
                        <View
                            key={username}
                            style={ui.row}
                        >
                            <Avatar name={username} />
                            <Text style={[ui.text, ui.fill]}>{username}</Text>
                            <Button
                                title="Разблокировать"
                                variant="ghost"
                                busy={action.busy}
                                onPress={() =>
                                    void action.run(async () => {
                                        if (
                                            await confirm(
                                                'Снять блокировку?',
                                                `Вы сможете добавить ${username} в друзья снова.`,
                                                'Разблокировать',
                                            )
                                        ) {
                                            await client.safety(username, 'unblock');
                                            await resource.reload();
                                        }
                                    })
                                }
                            />
                        </View>
                    ))
                ) : (
                    <Empty
                        icon="shield"
                        title="Здесь пока никого"
                        description="Заблокированные пользователи не смогут писать вам и звонить."
                    />
                )}
            </ScrollView>
        </View>
    );
}
