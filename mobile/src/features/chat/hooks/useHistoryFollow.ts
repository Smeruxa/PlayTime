import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { Message } from '../../../types';

export function useHistoryFollow(
    list: RefObject<FlatList<Message> | null>,
    latest: Message | undefined,
    query: string,
) {
    const previousId = useRef<number | undefined>(undefined);
    const following = useRef(true);
    const dragging = useRef(false);
    const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [newBelow, setNewBelow] = useState(false);
    const searching = !!query.trim();
    const latestId = latest?.id;
    const latestIsOwn = latest?.me;

    const scrollToLatest = useCallback(
        (animated: boolean) => {
            if (layoutTimer.current) {
                clearTimeout(layoutTimer.current);
            }
            layoutTimer.current = setTimeout(() => {
                if (following.current && !searching) {
                    list.current?.scrollToEnd({ animated });
                }
            }, 80);
        },
        [list, searching],
    );

    useEffect(() => {
        if (latestId === previousId.current) {
            return;
        }
        const firstPage = previousId.current == null;
        previousId.current = latestId;
        if (latestId == null || searching) {
            return;
        }
        if (firstPage || latestIsOwn || following.current) {
            dragging.current = false;
            following.current = true;
            setNewBelow(false);
            scrollToLatest(!firstPage);
            return;
        }
        setNewBelow(true);
    }, [latestId, latestIsOwn, searching, scrollToLatest]);

    useEffect(
        () => () => {
            if (layoutTimer.current) {
                clearTimeout(layoutTimer.current);
            }
        },
        [searching],
    );

    const followLayout = useCallback(() => {
        if (following.current && !searching) {
            scrollToLatest(false);
        }
    }, [scrollToLatest, searching]);

    const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
        const atBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 100;
        if (dragging.current) {
            following.current = atBottom;
        }
        if (atBottom) {
            setNewBelow(false);
        }
    }, []);

    const onScrollBeginDrag = useCallback(() => {
        dragging.current = true;
        following.current = false;
    }, []);

    const pause = useCallback(() => {
        dragging.current = false;
        following.current = false;
    }, []);

    const onMomentumScrollEnd = useCallback(() => {
        dragging.current = false;
    }, []);

    const goLatest = useCallback(() => {
        dragging.current = false;
        following.current = true;
        setNewBelow(false);
        scrollToLatest(true);
    }, [scrollToLatest]);

    return {
        newBelow,
        followLayout,
        onScroll,
        onScrollBeginDrag,
        onMomentumScrollEnd,
        goLatest,
        pause,
    };
}
