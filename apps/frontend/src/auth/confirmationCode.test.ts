import { confirmationCodeInput, isConfirmationCode } from "./confirmationCode"

test("confirmation codes keep leading zeros and accept exactly six ASCII digits", () => {
    expect(isConfirmationCode("012345")).toBe(true)
    expect(isConfirmationCode("000000")).toBe(true)
    for (const value of ["", "12345", "1234567", "ABCDEF", "12345A", "１２３４５６", "0123456789"]) {
        expect(isConfirmationCode(value)).toBe(false)
    }
})

test("pasted code formatting is removed without converting the code to a number", () => {
    expect(confirmationCodeInput(" 012 345 ")).toBe("012345")
    expect(confirmationCodeInput("012-345")).toBe("012345")
    expect(confirmationCodeInput("000123")).toBe("000123")
    expect(confirmationCodeInput("1234567")).toBe("123456")
    expect(confirmationCodeInput("letters")).toBe("")
})
