import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { Wallpaper } from '../../../types';
import { wallpapers } from '../wallpapers';

export function WallpaperBackdrop({ wallpaper }: { wallpaper: Wallpaper }) {
    if (wallpaper.kind === 'none') {
        return null;
    }
    if (wallpaper.kind === 'image') {
        return (
            <View
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
            >
                <Image
                    source={{ uri: wallpaper.dataUrl }}
                    blurRadius={wallpaper.blur * 0.24}
                    style={StyleSheet.absoluteFill}
                />
                <View
                    style={[
                        StyleSheet.absoluteFill,
                        { backgroundColor: `rgba(0,0,0,${wallpaper.dim / 100})` },
                    ]}
                />
            </View>
        );
    }
    const preset = wallpapers.find((item) => item.id === wallpaper.id);
    return (
        <View
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
        >
            <Svg
                width="100%"
                height="100%"
            >
                <Defs>
                    <LinearGradient
                        id="wallpaper"
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="1"
                    >
                        {preset?.colors.map((color, index) => (
                            <Stop
                                key={color}
                                offset={`${index * 50}%`}
                                stopColor={color}
                            />
                        ))}
                    </LinearGradient>
                </Defs>
                <Rect
                    width="100%"
                    height="100%"
                    fill="url(#wallpaper)"
                />
            </Svg>
        </View>
    );
}
