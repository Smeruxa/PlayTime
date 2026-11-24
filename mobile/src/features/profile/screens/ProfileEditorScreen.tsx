import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, ScrollView, Text, View } from 'react-native';
import { Button, ChoiceChips, Field, Header, Loading, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { confirm, pickImage } from '../../../platform/device';
import type { Profile } from '../../../types';
import { ProfilePreview } from '../components/ProfilePreview';
import { EffectPicker } from '../components/EffectPicker';
import { avatarEffects, bannerEffects, bannerStickers } from '../appearance';

export function ProfileEditorScreen() {
    const { client, state, back, navigate } = useApp();
    const [draft, setDraft] = useState<Profile | null>(state.profile);
    const [saved, setSaved] = useState<Profile | null>(state.profile);
    const [tab, setTab] = useState<'profile' | 'appearance'>('profile');
    const action = useAction();
    const { run } = action;
    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
    const limits = state.subscription?.limits;

    useEffect(() => {
        if (!state.profile) {
            void run(async () => {
                const profile = await client.getProfile();
                setDraft(profile);
                setSaved(profile);
            });
        }
    }, [client, run, state.profile]);

    const leave = useCallback(async () => {
        if (
            !dirty ||
            (await confirm(
                'Есть несохранённые изменения',
                'Выйти без сохранения профиля?',
                'Выйти',
            ))
        ) {
            back();
        }
    }, [back, dirty]);

    useEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            void leave();
            return true;
        });
        return () => handler.remove();
    }, [leave]);

    if (!draft) {
        return <Loading />;
    }
    const patch = (value: Partial<Profile>) => setDraft({ ...draft, ...value });
    const media = (kind: 'avatar' | 'profileBanner') =>
        run(async () => {
            const image = await pickImage();
            if (image) {
                patch({ [kind]: image.dataUri });
            }
        });
    const locked = () => navigate({ name: 'plan' });

    return (
        <View
            style={ui.page}
            testID="profile-editor-screen"
        >
            <Header
                title="Ваш профиль"
                onBack={() => void leave()}
            />
            <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={ui.content}
            >
                <ChoiceChips
                    value={tab}
                    onChange={setTab}
                    options={[
                        { value: 'profile', label: 'Профиль' },
                        { value: 'appearance', label: 'Оформление' },
                    ]}
                />
                <ProfilePreview profile={draft} />
                {tab === 'profile' ? (
                    <>
                        <Field
                            label="Статус"
                            testID="profile-status"
                            value={draft.status}
                            onChangeText={(status) => patch({ status })}
                            maxLength={120}
                            hint={`${draft.status.length}/120`}
                        />
                        <Field
                            label="О себе"
                            testID="profile-bio"
                            value={draft.bio}
                            onChangeText={(bio) => patch({ bio })}
                            multiline
                            maxLength={1000}
                            hint={`${draft.bio.length}/1000`}
                        />
                    </>
                ) : (
                    <>
                        <View style={ui.card}>
                            <Text style={ui.heading}>Аватар</Text>
                            <Button
                                title="Выбрать фото"
                                variant="secondary"
                                onPress={() => void media('avatar')}
                                disabled={action.busy}
                            />
                            {draft.avatar && (
                                <Button
                                    title="Убрать аватар"
                                    variant="ghost"
                                    onPress={() => patch({ avatar: null })}
                                />
                            )}
                            <EffectPicker
                                title="Эффект аватара"
                                testID="avatar-effect"
                                options={avatarEffects}
                                value={draft.profileAvatarEffect}
                                allowed={(id) =>
                                    id === 'none' ||
                                    !!limits?.profileAvatarEffectIds?.includes(id) ||
                                    (!!limits?.avatarEffectsAllowed &&
                                        !limits.profileAvatarEffectIds)
                                }
                                onChange={(profileAvatarEffect) => patch({ profileAvatarEffect })}
                                onLocked={locked}
                            />
                        </View>
                        <View style={ui.card}>
                            <Text style={ui.heading}>Баннер</Text>
                            <Button
                                title={
                                    limits?.profileBannerAllowed
                                        ? 'Выбрать баннер'
                                        : 'Баннер в расширенном плане'
                                }
                                variant="secondary"
                                onPress={() =>
                                    limits?.profileBannerAllowed
                                        ? void media('profileBanner')
                                        : locked()
                                }
                            />
                            {draft.profileBanner && (
                                <Button
                                    title="Убрать баннер"
                                    variant="ghost"
                                    onPress={() =>
                                        patch({
                                            profileBanner: null,
                                            profileBannerEffect: 'none',
                                            profileBannerSticker: 'none',
                                        })
                                    }
                                />
                            )}
                            <EffectPicker
                                title="Эффект баннера"
                                testID="banner-effect"
                                options={bannerEffects}
                                value={draft.profileBannerEffect}
                                allowed={(id) =>
                                    id === 'none' ||
                                    !!limits?.profileBannerEffectIds?.includes(id) ||
                                    (!!limits?.profileBannerEffectsAllowed &&
                                        !limits.profileBannerEffectIds)
                                }
                                onChange={(profileBannerEffect) => patch({ profileBannerEffect })}
                                onLocked={locked}
                            />
                            <EffectPicker
                                title="Стикер"
                                testID="banner-sticker"
                                options={bannerStickers}
                                value={draft.profileBannerSticker}
                                allowed={(id) =>
                                    id === 'none' || !!limits?.profileBannerEffectsAllowed
                                }
                                onChange={(profileBannerSticker) => patch({ profileBannerSticker })}
                                onLocked={locked}
                            />
                        </View>
                    </>
                )}
                <Notice
                    text={action.error}
                    tone="error"
                />
                <Notice
                    text={action.success}
                    tone="success"
                />
                <Button
                    title="Сохранить изменения"
                    testID="profile-save"
                    busy={action.busy}
                    disabled={!dirty}
                    onPress={() =>
                        void run(async () => {
                            await client.updateProfile({
                                status: draft.status,
                                bio: draft.bio,
                                avatar: draft.avatar,
                                profileBanner: draft.profileBanner,
                                profileAvatarEffect: draft.profileAvatarEffect,
                                profileBannerEffect: draft.profileBannerEffect,
                                profileBannerSticker: draft.profileBannerSticker,
                            });
                            setSaved(draft);
                        }, 'Профиль сохранён')
                    }
                />
                {dirty && (
                    <Button
                        title="Отменить изменения"
                        variant="ghost"
                        onPress={() => setDraft(saved)}
                    />
                )}
            </ScrollView>
        </View>
    );
}
