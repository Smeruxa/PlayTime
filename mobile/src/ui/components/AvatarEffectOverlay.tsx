import React, { useId } from 'react';
import { Animated, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { useDecorativeMotion } from '../hooks/useDecorativeMotion';

const rotations: Record<string, number> = {
    halo: 5000,
    orbit: 3200,
    frost: 8000,
    bloom: 10000,
    prism: 4500,
};
const supported = new Set(['halo', 'orbit', 'neon', 'stars', 'frost', 'flare', 'bloom', 'prism']);

export function AvatarEffectOverlay({
    effectId,
    size,
}: {
    effectId?: string | null;
    size: number;
}) {
    const effect = effectId || 'none';
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const gradient = `avatar${uid}`;
    const progress = useDecorativeMotion(rotations[effect] || 2800, 0.25, supported.has(effect));
    if (!supported.has(effect)) {
        return null;
    }
    const rotating = effect in rotations;
    const stops =
        effect === 'frost'
            ? ['#E8F4FF', '#9FD4FF', '#6EB8FF']
            : effect === 'flare'
            ? ['#FF6A2E', '#FFB347', '#FFE08A']
            : effect === 'prism'
            ? ['#FF6EB4', '#B388FF', '#5ECBFF', '#7DFFB3']
            : ['#2EE7FF', '#3AA8FF', '#6E7BFF'];
    return (
        <Animated.View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[
                styles.overlay,
                {
                    width: size * 1.16,
                    height: size * 1.16,
                    left: -size * 0.08,
                    top: -size * 0.08,
                    opacity: rotating
                        ? 1
                        : progress.interpolate({
                              inputRange: [0, 0.5, 1],
                              outputRange: [0.5, 1, 0.5],
                          }),
                    transform: [
                        {
                            rotate: rotating
                                ? progress.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: ['0deg', '360deg'],
                                  })
                                : '0deg',
                        },
                    ],
                },
            ]}
        >
            <Svg
                width="100%"
                height="100%"
                viewBox="0 0 100 100"
            >
                <Defs>
                    <LinearGradient
                        id={gradient}
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="100%"
                    >
                        {stops.map((color, index) => (
                            <Stop
                                key={color}
                                offset={`${(index * 100) / (stops.length - 1)}%`}
                                stopColor={color}
                            />
                        ))}
                    </LinearGradient>
                </Defs>
                {['halo', 'orbit', 'frost', 'flare', 'prism'].includes(effect) ? (
                    <>
                        <Circle
                            cx={50}
                            cy={50}
                            r={46}
                            fill="none"
                            stroke={`url(#${gradient})`}
                            strokeWidth={6}
                            opacity={0.13}
                            strokeDasharray={
                                effect === 'orbit'
                                    ? '72 220'
                                    : effect === 'prism'
                                    ? '90 200'
                                    : effect === 'frost'
                                    ? '8 10'
                                    : undefined
                            }
                        />
                        <Circle
                            cx={50}
                            cy={50}
                            r={46}
                            fill="none"
                            stroke={`url(#${gradient})`}
                            strokeWidth={effect === 'frost' ? 2.2 : 2.8}
                            strokeLinecap="round"
                            strokeDasharray={
                                effect === 'orbit'
                                    ? '72 220'
                                    : effect === 'prism'
                                    ? '90 200'
                                    : effect === 'frost'
                                    ? '8 10'
                                    : undefined
                            }
                        />
                    </>
                ) : null}
                {effect === 'neon' ? (
                    <>
                        <Circle
                            cx={50}
                            cy={50}
                            r={47}
                            fill="none"
                            stroke={`url(#${gradient})`}
                            strokeWidth={7}
                            opacity={0.16}
                        />
                        <Circle
                            cx={50}
                            cy={50}
                            r={47}
                            fill="none"
                            stroke={`url(#${gradient})`}
                            strokeWidth={2}
                            opacity={0.9}
                        />
                        <Circle
                            cx={50}
                            cy={50}
                            r={44}
                            fill="none"
                            stroke="#2EE7FF"
                            strokeWidth={1}
                            opacity={0.6}
                        />
                    </>
                ) : null}
                {effect === 'stars' ? (
                    <G fill="#FFFFFF">
                        <Path d="M28 24 L29.6 28.4 L34 30 L29.6 31.6 L28 36 L26.4 31.6 L22 30 L26.4 28.4 Z" />
                        <Path
                            d="M72 34 L73 37 L76 38 L73 39 L72 42 L71 39 L68 38 L71 37 Z"
                            fill="#2EE7FF"
                        />
                        <Circle
                            cx={62}
                            cy={72}
                            r={2.2}
                        />
                    </G>
                ) : null}
                {effect === 'frost' ? (
                    <G fill="#E8F4FF">
                        <Circle
                            cx={24}
                            cy={42}
                            r={1.6}
                        />
                        <Circle
                            cx={76}
                            cy={36}
                            r={1.3}
                        />
                        <Circle
                            cx={68}
                            cy={70}
                            r={1.4}
                        />
                    </G>
                ) : null}
                {effect === 'flare' ? (
                    <Circle
                        cx={50}
                        cy={50}
                        r={43}
                        fill="none"
                        stroke="#FF9040"
                        strokeWidth={1.2}
                        opacity={0.6}
                    />
                ) : null}
                {effect === 'bloom'
                    ? [0, 72, 144, 216, 288].map((angle) => (
                          <G
                              key={angle}
                              rotation={angle}
                              origin="50,50"
                          >
                              <Path
                                  d="M50 0 C53 4 54 8 50 13 C46 8 47 4 50 0 Z"
                                  fill="#FFB7D4"
                                  opacity={0.94}
                              />
                          </G>
                      ))
                    : null}
            </Svg>
        </Animated.View>
    );
}

const styles = StyleSheet.create({ overlay: { position: 'absolute' } });
