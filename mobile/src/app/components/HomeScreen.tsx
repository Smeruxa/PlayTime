import React from 'react';
import { useApp } from '../../state/AppContext';
import { ConversationsScreen } from '../../features/conversations/screens/ConversationsScreen';
import { FriendsScreen } from '../../features/friends/screens/FriendsScreen';
import { ProfileScreen } from '../../features/profile/screens/ProfileScreen';

export function HomeScreen() {
    const { tab } = useApp();
    switch (tab) {
        case 'chats':
            return <ConversationsScreen />;
        case 'rooms':
            return <ConversationsScreen roomsOnly />;
        case 'friends':
            return <FriendsScreen />;
        case 'profile':
            return <ProfileScreen />;
    }
}
