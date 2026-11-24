import { useMemo, useRef, useState } from 'react';
import { PanResponder, type GestureResponderEvent } from 'react-native';

type Transform = { scale: number; x: number; y: number };
const identity: Transform = { scale: 1, x: 0, y: 0 };

function distance(event: GestureResponderEvent): number {
    const [first, second] = event.nativeEvent.touches;
    return second ? Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY) : 0;
}

export function useImageTransform(width: number, height: number) {
    const [transform, setTransform] = useState<Transform>(identity);
    const current = useRef(identity);
    const origin = useRef(identity);
    const pinch = useRef(0);
    const lastTap = useRef(0);

    const gesture = useMemo(() => {
        const update = (next: Transform) => {
            const scale = Math.max(1, Math.min(4, next.scale));
            const maxX = (width * (scale - 1)) / 2;
            const maxY = (height * (scale - 1)) / 2;
            current.current = {
                scale,
                x: Math.max(-maxX, Math.min(maxX, next.x)),
                y: Math.max(-maxY, Math.min(maxY, next.y)),
            };
            setTransform(current.current);
        };
        return PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: (event) => {
                origin.current = current.current;
                pinch.current = distance(event);
            },
            onPanResponderMove: (event, state) => {
                const nextDistance = distance(event);
                if (nextDistance > 0) {
                    if (!pinch.current) {
                        pinch.current = nextDistance;
                        origin.current = current.current;
                    }
                    update({
                        ...origin.current,
                        scale: (origin.current.scale * nextDistance) / pinch.current,
                    });
                } else {
                    update({
                        ...origin.current,
                        x: origin.current.x + state.dx,
                        y: origin.current.y + state.dy,
                    });
                }
            },
            onPanResponderRelease: (_, state) => {
                if (Math.abs(state.dx) + Math.abs(state.dy) < 8) {
                    const now = Date.now();
                    if (now - lastTap.current < 300) {
                        update(current.current.scale > 1 ? identity : { scale: 2, x: 0, y: 0 });
                    }
                    lastTap.current = now;
                }
            },
        });
    }, [width, height]);

    const reset = () => {
        current.current = identity;
        setTransform(identity);
    };
    const zoom = () => {
        current.current = current.current.scale > 1 ? identity : { scale: 2, x: 0, y: 0 };
        setTransform(current.current);
    };
    return { transform, handlers: gesture.panHandlers, zoom, reset };
}
