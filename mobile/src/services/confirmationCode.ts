export function isConfirmationCode(value: string): boolean {
    return /^\d{6}$/.test(value.trim());
}

export function confirmationCode(value: string): string {
    const code = value.trim();
    if (!isConfirmationCode(code)) {
        throw new Error('Введите код из 6 цифр');
    }
    return code;
}
