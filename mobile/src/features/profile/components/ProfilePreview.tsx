import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';
import { publicImage } from '../../../platform/device';
import type { Profile } from '../../../types';
import { bannerStickers } from '../appearance';
import { BannerEffectOverlay } from './BannerEffectOverlay';

export function ProfilePreview({ profile }: { profile: Profile }) {
    const sticker = bannerStickers.find((option) => option.id === profile.profileBannerSticker);
    return (
        <View style={styles.card}>
            <View style={styles.banner}>
                {profile.profileBanner && (
                    <Image
                        source={{ uri: publicImage(profile.profileBanner) }}
                        style={StyleSheet.absoluteFill}
                    />
                )}
                <BannerEffectOverlay effectId={profile.profileBannerEffect} />
                {sticker?.id !== 'none' && <Text style={styles.sticker}>{sticker?.title}</Text>}
            </View>
            <View style={styles.identity}>
                <Avatar
                    name={profile.username}
                    uri={publicImage(profile.avatar)}
                    size={76}
                    effect={profile.profileAvatarEffect}
                />
                <Text style={ui.heading}>{profile.username}</Text>
                {!!profile.status && (
                    <Text style={[ui.muted, styles.status]}>{profile.status}</Text>
                )}
                {!!profile.bio && <Text style={ui.muted}>{profile.bio}</Text>}
                <Text style={ui.caption}>
                    С нами с{' '}
                    {new Date(profile.createdAt).toLocaleDateString('ru-RU', {
                        month: 'long',
                        year: 'numeric',
                    })}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: 20,
        backgroundColor: colors.surface,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#303030',
    },
    banner: { height: 126, backgroundColor: '#1C3440', overflow: 'hidden' },
    sticker: { position: 'absolute', right: 20, bottom: 12, fontSize: 38 },
    identity: { padding: 20, paddingTop: 0, gap: 10, marginTop: -34 },
    status: { color: colors.accent },
});
