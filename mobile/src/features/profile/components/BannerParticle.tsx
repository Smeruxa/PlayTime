import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { useDecorativeMotion } from '../../../ui/hooks/useDecorativeMotion';
import type { BannerParticleData, BannerParticleKind } from '../particles';

export function BannerParticle({
    kind,
    particle,
    width,
    height,
}: {
    kind: BannerParticleKind;
    particle: BannerParticleData;
    width: number;
    height: number;
}) {
    const progress = useDecorativeMotion(particle.duration, particle.phase, width > 0);
    const floating = kind === 'stars';
    const unit = Math.max(0.7, width / 600);
    const diameter = particle.radius * 2 * unit;
    const start = kind === 'ember' ? height + 12 : floating ? (particle.y / 200) * height : -18;
    const end = kind === 'ember' ? -16 : floating ? start - 25 * unit : height + 18;
    return (
        <Animated.View
            pointerEvents="none"
            style={[
                styles.particle,
                {
                    width: diameter,
                    height: diameter,
                    left: (particle.x / 600) * width,
                    opacity: progress.interpolate({
                        inputRange: [0, 0.12, 0.5, 0.88, 1],
                        outputRange: [0.15, 0.95, 0.7, 0.8, 0.1],
                    }),
                    transform: [
                        {
                            translateY: progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [start, end],
                            }),
                        },
                        {
                            translateX: progress.interpolate({
                                inputRange: [0, 0.5, 1],
                                outputRange: [
                                    0,
                                    particle.drift * unit,
                                    floating ? -particle.drift * unit : particle.drift * unit,
                                ],
                            }),
                        },
                        {
                            rotate: progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [
                                    '0deg',
                                    kind === 'sakura'
                                        ? '300deg'
                                        : kind === 'snow'
                                        ? '180deg'
                                        : '0deg',
                                ],
                            }),
                        },
                    ],
                },
            ]}
        >
            <Svg
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
            >
                {kind === 'sakura' ? (
                    <Path
                        d="M12 1 C17 7 19 15 12 23 C5 15 7 7 12 1 Z"
                        fill={particle.color}
                    />
                ) : kind === 'snow' ? (
                    <G
                        stroke={particle.color}
                        strokeWidth={1.3}
                        strokeLinecap="round"
                    >
                        <Line
                            x1={12}
                            y1={2}
                            x2={12}
                            y2={22}
                        />
                        <Line
                            x1={3}
                            y1={7}
                            x2={21}
                            y2={17}
                        />
                        <Line
                            x1={3}
                            y1={17}
                            x2={21}
                            y2={7}
                        />
                    </G>
                ) : (
                    <>
                        <Circle
                            cx={12}
                            cy={12}
                            r={11}
                            fill={particle.color}
                            opacity={0.18}
                        />
                        <Circle
                            cx={12}
                            cy={12}
                            r={5}
                            fill={particle.color}
                        />
                    </>
                )}
            </Svg>
        </Animated.View>
    );
}

const styles = StyleSheet.create({ particle: { position: 'absolute', top: 0 } });
