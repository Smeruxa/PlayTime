import React from 'react';
import type { Route } from '../../state/AppContext';
import { HomeScreen } from './HomeScreen';
import { ChatScreen } from '../../features/chat/screens/ChatScreen';
import { CreateRoomScreen } from '../../features/rooms/screens/CreateRoomScreen';
import { RoomScreen } from '../../features/rooms/screens/RoomScreen';
import { ProfileEditorScreen } from '../../features/profile/screens/ProfileEditorScreen';
import { PlanScreen } from '../../features/profile/screens/PlanScreen';
import { SettingsScreen } from '../../features/settings/screens/SettingsScreen';
import { WallpaperScreen } from '../../features/chat/screens/WallpaperScreen';
import { PeerProfileScreen } from '../../features/safety/screens/PeerProfileScreen';
import { BlockedUsersScreen } from '../../features/safety/screens/BlockedUsersScreen';
import { AccountScreen } from '../../features/account/screens/AccountScreen';
import { SessionsScreen } from '../../features/account/screens/SessionsScreen';
import { PasswordScreen } from '../../features/account/screens/PasswordScreen';
import { DeleteAccountScreen } from '../../features/account/screens/DeleteAccountScreen';
import { KeysBackupScreen } from '../../features/account/screens/KeysBackupScreen';
import { KeyTransferScreen } from '../../features/account/screens/KeyTransferScreen';

export function RouteScreen({ route }: { route: Route }) {
    switch (route.name) {
        case 'home':
            return <HomeScreen />;
        case 'chat':
            return <ChatScreen />;
        case 'createRoom':
            return <CreateRoomScreen />;
        case 'room':
            return <RoomScreen />;
        case 'profileEdit':
            return <ProfileEditorScreen />;
        case 'account':
            return <AccountScreen />;
        case 'sessions':
            return <SessionsScreen />;
        case 'password':
            return <PasswordScreen />;
        case 'deleteAccount':
            return <DeleteAccountScreen />;
        case 'backup':
            return <KeysBackupScreen mode="backup" />;
        case 'restore':
            return <KeysBackupScreen mode="restore" />;
        case 'transfer':
            return <KeyTransferScreen />;
        case 'settings':
            return <SettingsScreen />;
        case 'wallpaper':
            return <WallpaperScreen />;
        case 'plan':
            return <PlanScreen />;
        case 'blocked':
            return <BlockedUsersScreen />;
        case 'peer':
            return (
                <PeerProfileScreen
                    username={route.username}
                    peerUserId={route.peerUserId}
                />
            );
    }
}
