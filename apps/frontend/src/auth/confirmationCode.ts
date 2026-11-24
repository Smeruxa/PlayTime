export const CONFIRMATION_CODE_LENGTH = 6

export function isConfirmationCode(code: string): boolean {
    return /^[0-9]{6}$/.test(code)
}

export function confirmationCodeInput(value: string): string {
    return value.replace(/[^0-9]/g, "").slice(0, CONFIRMATION_CODE_LENGTH)
}
