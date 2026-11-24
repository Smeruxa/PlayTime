import React from 'react';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ApplicationShell } from './components/ApplicationShell';

export default function App() {
    return (
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <AppErrorBoundary>
                <ApplicationShell />
            </AppErrorBoundary>
        </SafeAreaProvider>
    );
}
