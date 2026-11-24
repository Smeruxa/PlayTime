import type { PlanLimits } from '../../types';

export type ScreenShareLimits = {
    maxFps: number;
    targetLongSide: number;
};

const DEFAULT_SCREEN_LIMITS: ScreenShareLimits = {
    maxFps: 10,
    targetLongSide: 854,
};

function positiveLimit(value: number | undefined, fallback: number, maximum: number) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.min(maximum, Math.max(1, Math.floor(value)))
        : fallback;
}

export function screenShareLimits(limits: PlanLimits | null): ScreenShareLimits {
    return {
        maxFps: positiveLimit(limits?.maxScreenBroadcastFps, DEFAULT_SCREEN_LIMITS.maxFps, 60),
        targetLongSide: positiveLimit(
            limits?.screenShare?.targetLongSide,
            DEFAULT_SCREEN_LIMITS.targetLongSide,
            1920,
        ),
    };
}

export function screenResolutionScale(
    width: number,
    height: number,
    targetLongSide: number,
): number {
    const longSide = Math.max(width, height);
    return Number.isFinite(longSide) && longSide > 0 ? Math.max(1, longSide / targetLongSide) : 1;
}
