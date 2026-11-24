const participantVolumeByUsername = new Map<string, number>()

export function getParticipantVolume(username: string): number {
    const v = participantVolumeByUsername.get(username)
    return v !== undefined ? v / 100 : 1
}

export function getParticipantVolumePercent(username: string): number {
    const v = participantVolumeByUsername.get(username)
    return v !== undefined ? v : 100
}

export function setParticipantVolume(username: string, percent: number): void {
    if (!Number.isFinite(percent)) return
    participantVolumeByUsername.set(username, Math.max(0, Math.min(100, percent)))
}
