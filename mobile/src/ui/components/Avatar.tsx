import React from 'react';
import { Image, Text, View } from 'react-native';
import { colors } from '../theme';
import { Icon } from '../Icon';
import { AvatarEffectOverlay } from './AvatarEffectOverlay';

export function Avatar({
    name,
    uri,
    size = 48,
    online,
    room,
    effect,
}: {
    name: string;
    uri?: string | null;
    size?: number;
    online?: boolean;
    room?: boolean;
    effect?: string | null;
}) {
    const tint = room
        ? '#235552'
        : ['#28465D', '#49345C', '#4B4630', '#35504D'][
              Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0) % 4
          ];
    return (
        <View style={{ width: size, height: size }}>
            <View
                style={{
                    width: size,
                    height: size,
                    borderRadius: room ? size * 0.29 : size / 2,
                    backgroundColor: tint,
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                }}
            >
                {uri ? (
                    <Image
                        source={{ uri }}
                        style={{ width: '100%', height: '100%' }}
                    />
                ) : room ? (
                    <Icon
                        name="room"
                        size={size * 0.44}
                        color="#9FE1D7"
                    />
                ) : (
                    <Text
                        allowFontScaling={false}
                        style={{ color: '#E7EDF9', fontWeight: '600', fontSize: size * 0.36 }}
                    >
                        {Array.from(name.trim()).slice(0, 2).join('').toUpperCase() || '?'}
                    </Text>
                )}
            </View>
            {!room && (
                <AvatarEffectOverlay
                    effectId={effect}
                    size={size}
                />
            )}
            {online != null && (
                <View
                    style={{
                        position: 'absolute',
                        right: 0,
                        bottom: 0,
                        height: 12,
                        width: 12,
                        borderRadius: 6,
                        borderWidth: 3,
                        borderColor: colors.bg,
                        backgroundColor: online ? colors.success : colors.subtle,
                    }}
                />
            )}
        </View>
    );
}
