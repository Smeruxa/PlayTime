module.exports = {
    preset: '@react-native/jest-preset',
    testMatch: [
        '<rootDir>/tests/calls.test.ts',
        '<rootDir>/tests/native-voice-mesh.test.ts',
        '<rootDir>/tests/account-files.test.ts',
        '<rootDir>/tests/attachment-message.test.ts',
        '<rootDir>/tests/push-lifecycle.test.ts',
        '<rootDir>/tests/notification-preferences.test.ts',
    ],
};
