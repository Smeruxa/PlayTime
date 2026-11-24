import React, { useId, useMemo, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useDecorativeMotion } from '../../../ui/hooks/useDecorativeMotion';
import { bannerParticles, type BannerParticleKind } from '../particles';
import { BannerParticle } from './BannerParticle';

const supported = new Set(['glow', 'sakura', 'snow', 'stars', 'ember']);

export function BannerEffectOverlay({ effectId }: { effectId?: string | null }) {
    const effect = effectId || 'none';
    const [size, setSize] = useState({ width: 0, height: 0 });
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const gradient = `banner${uid}`;
    const progress = useDecorativeMotion(14000, 0.25, effect === 'glow');
    const particles = useMemo(
        () =>
            supported.has(effect) && effect !== 'glow'
                ? bannerParticles(effect as BannerParticleKind)
                : [],
        [effect],
    );
    if (!supported.has(effect)) {
        return null;
    }
    return (
        <View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={styles.overlay}
            onLayout={(event) => setSize(event.nativeEvent.layout)}
        >
            <Animated.View
                style={[
                    StyleSheet.absoluteFill,
                    {
                        opacity:
                            effect === 'glow'
                                ? progress.interpolate({
                                      inputRange: [0, 0.5, 1],
                                      outputRange: [0.4, 0.8, 0.4],
                                  })
                                : 1,
                    },
                ]}
            >
                <Svg
                    width="100%"
                    height="100%"
                    viewBox="0 0 600 200"
                    preserveAspectRatio="none"
                >
                    <Defs>
                        {effect === 'glow' ? (
                            <RadialGradient
                                id={gradient}
                                cx="30%"
                                cy="25%"
                                rx="65%"
                                ry="100%"
                            >
                                <Stop
                                    offset="0%"
                                    stopColor="#82CBDC"
                                    stopOpacity={0.55}
                                />
                                <Stop
                                    offset="100%"
                                    stopColor="#82CBDC"
                                    stopOpacity={0}
                                />
                            </RadialGradient>
                        ) : (
                            <LinearGradient
                                id={gradient}
                                x1="0%"
                                y1={effect === 'ember' ? '100%' : '0%'}
                                x2="0%"
                                y2={effect === 'ember' ? '0%' : '100%'}
                            >
                                <Stop
                                    offset="0%"
                                    stopColor={effect === 'ember' ? '#FF5A1E' : '#FFB4D2'}
                                    stopOpacity={effect === 'ember' ? 0.35 : 0.12}
                                />
                                <Stop
                                    offset="100%"
                                    stopColor={effect === 'ember' ? '#140804' : '#501432'}
                                    stopOpacity={effect === 'ember' ? 0 : 0.2}
                                />
                            </LinearGradient>
                        )}
                    </Defs>
                    <Rect
                        width={600}
                        height={200}
                        fill={
                            effect === 'snow'
                                ? '#B4D7FF'
                                : effect === 'stars'
                                ? '#080C20'
                                : `url(#${gradient})`
                        }
                        opacity={effect === 'snow' ? 0.1 : effect === 'stars' ? 0.5 : 1}
                    />
                </Svg>
            </Animated.View>
            {particles.map((particle, index) => (
                <BannerParticle
                    key={`${effect}-${index}`}
                    kind={effect as BannerParticleKind}
                    particle={particle}
                    width={size.width}
                    height={size.height}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({ overlay: { ...StyleSheet.absoluteFill, overflow: 'hidden' } });
