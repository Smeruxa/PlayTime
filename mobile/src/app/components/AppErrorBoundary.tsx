import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../ui/components';
import { ui } from '../../ui/theme';

type Props = { children: React.ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends React.Component<Props, State> {
    state: State = { failed: false };

    static getDerivedStateFromError(): State {
        return { failed: true };
    }

    render() {
        if (this.state.failed) {
            return (
                <View
                    style={[ui.page, ui.content, { justifyContent: 'center' }]}
                    testID="app-error"
                >
                    <Text style={ui.title}>Что-то пошло не так</Text>
                    <Text style={ui.muted}>
                        Попробуйте открыть приложение снова. Ключи переписки и сессия сохранены на
                        устройстве.
                    </Text>
                    <Button
                        title="Повторить"
                        onPress={() => this.setState({ failed: false })}
                    />
                </View>
            );
        }
        return this.props.children;
    }
}
