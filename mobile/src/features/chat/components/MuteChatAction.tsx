import React, { useEffect, useState } from 'react';
import type { ChatRef } from '../../../types';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import {
    chatNotificationsMuted,
    setChatNotificationsMuted,
} from '../../../platform/notificationPreferences';
import { Notice } from '../../../ui/components';
import { ActionRow } from './ActionRow';

export function MuteChatAction({ chat }: { chat: ChatRef }) {
    const { state } = useApp();
    const userId = state.session?.user.id;
    const [muted, setMuted] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const action = useAction();
    const { run } = action;

    useEffect(() => {
        let mounted = true;
        if (userId) {
            void run(async () => {
                const value = await chatNotificationsMuted(userId, chat);
                if (mounted) {
                    setMuted(value);
                    setLoaded(true);
                }
            });
        }
        return () => {
            mounted = false;
        };
    }, [chat, run, userId]);

    return (
        <>
            <ActionRow
                icon="bell"
                title={
                    !loaded
                        ? 'Загружаем настройки…'
                        : muted
                        ? 'Включить уведомления чата'
                        : 'Отключить уведомления чата'
                }
                onPress={() => {
                    if (loaded && userId) {
                        void action.run(async () => {
                            await setChatNotificationsMuted(userId, chat, !muted);
                            setMuted(!muted);
                        });
                    }
                }}
            />
            <Notice
                text={action.error}
                tone="error"
            />
        </>
    );
}
