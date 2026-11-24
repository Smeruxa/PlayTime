import AsyncStorage from '@react-native-async-storage/async-storage';
import { environmentKey } from '../services/storageScope';
import { native } from './NativePlayTime';

export const preferencesStorage = {
    async keys(): Promise<string[]> {
        const prefix = environmentKey(native.apiBase, '');
        const keys = await AsyncStorage.getAllKeys();
        return keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    },
    getItem(key: string): Promise<string | null> {
        return AsyncStorage.getItem(environmentKey(native.apiBase, key));
    },
    setItem(key: string, value: string): Promise<void> {
        return AsyncStorage.setItem(environmentKey(native.apiBase, key), value);
    },
    removeItem(key: string): Promise<void> {
        return AsyncStorage.removeItem(environmentKey(native.apiBase, key));
    },
};
