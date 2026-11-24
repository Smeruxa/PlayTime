import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Avatar } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import type { CallAvatarMap, CallParticipant } from '../types';
import { styles } from './styles';

type Props = {
    participant: CallParticipant;
    visual?: CallAvatarMap[string];
    self: boolean;
    muted: boolean;
    connected: boolean;
    volume: number;
    count: number;
    compact: boolean;
    onVolume: () => void;
};

export function CallParticipantCard({
    participant,
    visual,
    self,
    muted,
    connected,
    volume,
    count,
    compact,
    onVolume,
}: Props) {
    return (
        <Pressable
            testID={`call-participant-${participant.userId}`}
            accessibilityRole={self ? 'text' : 'button'}
            accessibilityLabel={`${participant.username}${self ? ', вы' : ', изменить громкость'}`}
            disabled={self}
            onPress={onVolume}
            style={[styles.participant, count === 2 && styles.participantDuo]}
        >
            <View style={[styles.avatarRing, connected && styles.avatarRingConnected]}>
                <Avatar
                    name={participant.username}
                    uri={visual?.avatar}
                    effect={visual?.profileAvatarEffect}
                    size={compact ? 60 : count > 4 ? 64 : 82}
                />
            </View>
            <Text
                numberOfLines={2}
                style={styles.participantName}
            >
                {participant.username}
            </Text>
            <Text style={ui.caption}>
                {self
                    ? muted
                        ? 'Вы · микрофон выключен'
                        : 'Вы'
                    : `${volume}% · нажмите для настройки`}
            </Text>
        </Pressable>
    );
}
