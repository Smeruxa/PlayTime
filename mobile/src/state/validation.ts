export function emailError(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254
        ? ''
        : 'Введите корректный email';
}
export function passwordError(password: string) {
    if (password.length < 12 || password.length > 50) {
        return 'Пароль должен содержать от 12 до 50 символов';
    }
    const bytes = Array.from(password).reduce((n, c) => {
        const cp = c.codePointAt(0)!;
        return n + (cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4);
    }, 0);
    return bytes > 72 ? 'Пароль слишком длинный в байтах. Сократите кириллицу или эмодзи.' : '';
}
export function formatBytes(bytes: number) {
    return bytes < 1024 * 1024
        ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
        : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
export function formatTime(date: number) {
    return new Date(date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
export function formatDay(date: number) {
    const now = new Date();
    const d = new Date(date);
    if (now.toDateString() === d.toDateString()) {
        return 'Сегодня';
    }
    now.setDate(now.getDate() - 1);
    if (now.toDateString() === d.toDateString()) {
        return 'Вчера';
    }
    return d.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    });
}
