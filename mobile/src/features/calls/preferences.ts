import { preferencesStorage } from '../../platform/preferencesStorage';

export type CallPreferences = {
    muted: boolean;
    masterVolume: number;
    participantVolumes: Record<number, number>;
};

export const clampVolume = (value: number) =>
    Number.isFinite(value) ? Math.min(200, Math.max(0, Math.round(value))) : 100;

export async function loadCallPreferences(userId: number): Promise<Partial<CallPreferences>> {
    try {
        const raw = await preferencesStorage.getItem(`playtime.calls.${userId}`);
        if (!raw) {
            return {};
        }
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return {};
        }
        const data = parsed as Partial<CallPreferences>;
        const participantVolumes: Record<number, number> = {};
        if (data.participantVolumes && typeof data.participantVolumes === 'object') {
            Object.entries(data.participantVolumes)
                .slice(0, 1000)
                .forEach(([id, value]) => {
                    if (
                        Number.isSafeInteger(Number(id)) &&
                        Number(id) > 0 &&
                        typeof value === 'number'
                    ) {
                        participantVolumes[Number(id)] = clampVolume(value);
                    }
                });
        }
        return {
            muted: data.muted === true,
            masterVolume: clampVolume(data.masterVolume ?? 100),
            participantVolumes,
        };
    } catch {
        return {};
    }
}

export async function saveCallPreferences(userId: number, value: CallPreferences): Promise<void> {
    await preferencesStorage.setItem(`playtime.calls.${userId}`, JSON.stringify(value));
}
