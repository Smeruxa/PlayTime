import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList } from 'react-native';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import type { Message } from '../../../types';
import { loadMessage } from '../loadMessage';

export function useHistoryJump(
    list: RefObject<FlatList<Message> | null>,
    selectedId?: number | null,
) {
    const { client, state } = useApp();
    const action = useAction();
    const { run } = action;
    const [highlighted, setHighlighted] = useState<number | null>(null);
    const mounted = useRef(true);
    const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingId = useRef<number | null>(null);
    const retryCount = useRef(0);
    const messages = useRef(state.messages);
    messages.current = state.messages;

    const scrollToPending = useCallback(() => {
        if (!mounted.current || pendingId.current == null) {
            return;
        }
        const index = messages.current.findIndex((message) => message.id === pendingId.current);
        if (index >= 0) {
            list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
        }
    }, [list]);

    const jump = useCallback(
        (id: number) =>
            run(async () => {
                const chat = client.snapshot.currentChat;
                const active = () => mounted.current && client.snapshot.currentChat === chat;
                setHighlighted(id);
                if (!(await loadMessage(id, client, active))) {
                    setHighlighted(null);
                    return;
                }
                setHighlighted(id);
                pendingId.current = id;
                retryCount.current = 0;
                if (retry.current) {
                    clearTimeout(retry.current);
                }
                retry.current = setTimeout(scrollToPending, 80);
            }),
        [client, run, scrollToPending],
    );

    useEffect(() => {
        if (selectedId != null) {
            void jump(selectedId);
        }
    }, [jump, selectedId]);

    useEffect(() => {
        if (highlighted == null || action.busy) {
            return;
        }
        const timer = setTimeout(() => setHighlighted(null), 2500);
        return () => clearTimeout(timer);
    }, [highlighted, action.busy]);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (retry.current) {
                clearTimeout(retry.current);
            }
        };
    }, []);

    const onScrollToIndexFailed = useCallback(
        ({ averageItemLength, index }: { averageItemLength: number; index: number }) => {
            if (!mounted.current || retryCount.current >= 5) {
                return;
            }
            retryCount.current += 1;
            list.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
            if (retry.current) {
                clearTimeout(retry.current);
            }
            retry.current = setTimeout(scrollToPending, 180);
        },
        [list, scrollToPending],
    );

    return { jump, highlighted, onScrollToIndexFailed, error: action.error, busy: action.busy };
}
