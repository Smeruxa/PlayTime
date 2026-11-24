import React, { useEffect, useState } from 'react';
import { BackHandler, Keyboard, View } from 'react-native';
import { Loading, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { ChatHeader } from '../components/ChatHeader';
import { ChatComposer } from '../components/ChatComposer';
import { ChatHistory } from '../components/ChatHistory';
import { ChatActionsSheet, type ChatActionTarget } from '../components/ChatActionsSheet';
import { EncryptionNotice } from '../components/EncryptionNotice';
import { ChatSearchBar } from '../components/ChatSearchBar';
import { useChatSearch } from '../hooks/useChatSearch';
import { useChatComposer } from '../hooks/useChatComposer';

export function ChatScreen() {
    const { client, state, calls, showCall } = useApp();
    const [target, setTarget] = useState<ChatActionTarget | null>(null);
    const [search, setSearch] = useState(false);
    const searchState = useChatSearch(state.messages);
    const { query, setQuery } = searchState;
    const composer = useChatComposer();
    const action = useAction();
    const { emojiOpen, setEmojiOpen } = composer;

    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (target || emojiOpen) {
                setTarget(null);
                setEmojiOpen(false);
                return true;
            }
            if (search) {
                setSearch(false);
                setQuery('');
                return true;
            }
            return false;
        });
        return () => subscription.remove();
    }, [target, emojiOpen, setEmojiOpen, search, setQuery]);

    useEffect(() => () => client.typing(false), [client]);
    const chat = state.currentChat;
    if (!chat) {
        return <Loading />;
    }
    const changedPeer = !chat.isRoom && state.encryption.changedPeer?.peerUserId === chat.id;
    const encrypted = state.encryption.ready && !changedPeer;

    return (
        <View
            style={ui.page}
            testID="chat-screen"
        >
            <ChatHeader
                onMenu={() => {
                    Keyboard.dismiss();
                    setTarget({ kind: 'chat' });
                }}
                onCall={() =>
                    void action.run(async () => {
                        if (!calls) {
                            throw new Error('Соединение ещё не готово');
                        }
                        if (chat.isRoom) {
                            await calls.joinParty(chat.id, chat.name);
                        } else {
                            if (chat.archived) {
                                throw new Error('Гость вышел');
                            }
                            await calls.start(chat.name, chat.id);
                        }
                        showCall();
                    })
                }
            />
            <Notice
                text={action.error}
                tone="error"
            />
            <EncryptionNotice />
            {chat.archived && <Notice text="Гость вышел. Переписка доступна только для чтения." />}
            {search && (
                <ChatSearchBar
                    search={searchState}
                    onClose={() => {
                        setSearch(false);
                        setQuery('');
                        Keyboard.dismiss();
                    }}
                />
            )}
            <ChatHistory
                query={query}
                selectedId={searchState.selectedId}
                onActions={(message) => setTarget({ kind: 'message', message })}
            />
            {!chat.archived && (
                <ChatComposer
                    composer={composer}
                    enabled={!!encrypted && !chat.archived}
                    connected={state.connection === 'online'}
                />
            )}
            {target && (
                <ChatActionsSheet
                    target={target}
                    onClose={() => setTarget(null)}
                    onSearch={() => {
                        setSearch(!search);
                        setQuery('');
                    }}
                    onReply={composer.replyTo}
                    onEdit={composer.editMessage}
                />
            )}
        </View>
    );
}
