import React from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppContext } from '../../state/AppContext';
import { ui } from '../../ui/theme';
import { Button, Loading, Notice } from '../../ui/components';
import { AuthScreen } from '../../features/auth/screens/AuthScreen';
import { CallScreen } from '../../features/calls/components/CallScreen';
import { IncomingCallSheet } from '../../features/calls/components/IncomingCallSheet';
import { ActiveCallBar } from '../../features/calls/components/ActiveCallBar';
import { useApplication } from '../hooks/useApplication';
import { BottomNavigation } from './BottomNavigation';
import { ConnectionBanner } from './ConnectionBanner';
import { RouteScreen } from './RouteScreen';

export function ApplicationShell() {
    const app = useApplication();
    const { client, state, calls } = app.context;
    return (
        <AppContext.Provider value={app.context}>
            <StatusBar barStyle="light-content" />
            <SafeAreaView
                style={ui.page}
                edges={['top', 'bottom', 'left', 'right']}
            >
                {state.bootstrapping ? (
                    <Loading label="Подключаем PlayTime…" />
                ) : !state.session ? (
                    <>
                        <Notice
                            text={state.error}
                            tone="error"
                            action={
                                <Button
                                    title="Повторить подключение"
                                    variant="ghost"
                                    onPress={() => void client.bootstrap()}
                                />
                            }
                        />
                        <AuthScreen client={client} />
                    </>
                ) : (
                    <>
                        <ConnectionBanner />
                        {state.error && (
                            <Notice
                                text={state.error}
                                tone="error"
                                action={
                                    <Button
                                        title="Понятно"
                                        variant="ghost"
                                        onPress={() => client.clearError()}
                                    />
                                }
                            />
                        )}
                        {app.callVisible && app.callActive && calls ? (
                            <CallScreen
                                controller={calls}
                                avatars={state.avatars}
                                myUserId={state.session.user.id}
                                onMinimize={app.minimizeCall}
                            />
                        ) : (
                            <>
                                {calls && (
                                    <ActiveCallBar
                                        controller={calls}
                                        onPress={app.context.showCall}
                                    />
                                )}
                                <View style={ui.fill}>
                                    <RouteScreen
                                        key={
                                            app.route.name === 'chat'
                                                ? `chat:${state.currentChat?.isRoom}:${state.currentChat?.id}`
                                                : app.route.name
                                        }
                                        route={app.route}
                                    />
                                </View>
                                {app.route.name === 'home' && !app.keyboardVisible && (
                                    <BottomNavigation />
                                )}
                            </>
                        )}
                        {calls && (
                            <IncomingCallSheet
                                controller={calls}
                                avatars={state.avatars}
                            />
                        )}
                    </>
                )}
            </SafeAreaView>
        </AppContext.Provider>
    );
}
