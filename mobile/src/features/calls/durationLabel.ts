export function durationLabel(startedAt?: number) {
    if (!startedAt) {
        return '';
    }
    const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const hours = Math.floor(total / 3600);
    return `${hours ? `${hours}:` : ''}${String(Math.floor(total / 60) % 60).padStart(
        2,
        '0',
    )}:${String(total % 60).padStart(2, '0')}`;
}
