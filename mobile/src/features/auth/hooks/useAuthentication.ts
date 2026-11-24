import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard } from 'react-native';
import type { PlayTimeClient } from '../../../services/client';
import { ApiError } from '../../../services/http';
import { confirmationCode } from '../../../services/confirmationCode';
import { useAction } from '../../../state/useAction';
import { emailError, passwordError } from '../../../state/validation';

export type AuthMode = 'login' | 'register' | 'recovery' | 'verify';

export function useAuthentication(client: PlayTimeClient) {
    const [mode, setMode] = useState<AuthMode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [repeat, setRepeat] = useState('');
    const [username, setUsername] = useState('');
    const [code, setCode] = useState('');
    const [accepted, setAccepted] = useState(false);
    const [sent, setSent] = useState(false);
    const [done, setDone] = useState(false);
    const [resendAt, setResendAt] = useState(0);
    const [clock, setClock] = useState(Date.now());
    const [ready, setReady] = useState(false);
    const mounted = useRef(true);
    const flowGeneration = useRef(0);
    const action = useAction();
    const { setError, setSuccess } = action;
    const invalidateFlow = useCallback(() => {
        flowGeneration.current++;
    }, []);
    const changeMode = useCallback(
        (next: AuthMode) => {
            invalidateFlow();
            Keyboard.dismiss();
            setMode(next);
            setSent(false);
            setDone(false);
            setPassword('');
            setRepeat('');
            setCode('');
            setResendAt(0);
            if (next === 'login' || next === 'recovery') {
                void client.authFlow.clear().catch(() => {});
            }
            setError('');
            setSuccess('');
        },
        [client, invalidateFlow, setError, setSuccess],
    );
    useEffect(() => {
        let active = true;
        mounted.current = true;
        void client.authFlow
            .load()
            .then((draft) => {
                if (!active) {
                    return;
                }
                if (draft) {
                    setMode(draft.mode);
                    setEmail(draft.email);
                    setUsername(draft.username);
                    setResendAt(draft.resendAt);
                    setClock(Date.now());
                }
                setReady(true);
            })
            .catch(() => {
                if (active) {
                    setReady(true);
                }
            });
        return () => {
            active = false;
            mounted.current = false;
            invalidateFlow();
        };
    }, [client, invalidateFlow]);
    useEffect(() => {
        if (!ready || done || (mode !== 'register' && mode !== 'verify')) {
            return;
        }
        const generation = flowGeneration.current;
        const save = () => {
            if (!mounted.current || generation !== flowGeneration.current) {
                return;
            }
            void client.authFlow.save({ mode, email, username, resendAt }).catch(() => {
                if (mounted.current && generation === flowGeneration.current) {
                    setError('Не удалось сохранить шаг регистрации. Не закрывайте приложение.');
                }
            });
        };
        const timer = setTimeout(save, 200);
        const subscription = AppState.addEventListener('change', (next) => {
            if (next !== 'active') {
                save();
            }
        });
        return () => {
            clearTimeout(timer);
            subscription.remove();
        };
    }, [client, ready, done, mode, email, username, resendAt, setError]);
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (next) => {
            if (next === 'active') {
                setClock(Date.now());
            }
        });
        return () => subscription.remove();
    }, []);
    useEffect(() => {
        if (resendAt <= Date.now()) {
            return;
        }
        const timer = setInterval(() => {
            const now = Date.now();
            setClock(now);
            if (now >= resendAt) {
                clearInterval(timer);
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [resendAt]);
    useEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            if (mode === 'login') {
                return false;
            }
            changeMode('login');
            return true;
        });
        return () => handler.remove();
    }, [mode, changeMode]);
    const submit = () =>
        action.run(async () => {
            const generation = flowGeneration.current;
            const current = () => mounted.current && generation === flowGeneration.current;
            const invalidEmail = emailError(email);
            if (invalidEmail) {
                throw new Error(invalidEmail);
            }
            if (mode === 'login') {
                if (!password || password.length > 50) {
                    throw new Error('Введите пароль');
                }
                try {
                    await client.login(email.trim().toLowerCase(), password);
                    setPassword('');
                } catch (error) {
                    if (
                        error &&
                        typeof error === 'object' &&
                        'verificationRequired' in error &&
                        error.verificationRequired === true
                    ) {
                        if (!current()) {
                            return;
                        }
                        await client.authFlow.save({
                            mode: 'verify',
                            email: email.trim().toLowerCase(),
                            username: '',
                            resendAt: 0,
                        });
                        if (!current()) {
                            return;
                        }
                        changeMode('verify');
                        return;
                    }
                    throw error;
                }
            } else if (mode === 'register') {
                if (
                    username.trim().length < 3 ||
                    username.trim().length > 15 ||
                    /[\s\u200B-\u200D\uFEFF]/u.test(username.trim())
                ) {
                    throw new Error('Никнейм — от 3 до 15 символов без пробелов');
                }
                const invalid = passwordError(password);
                if (invalid) {
                    throw new Error(invalid);
                }
                if (password !== repeat) {
                    throw new Error('Пароли не совпадают');
                }
                if (!accepted) {
                    throw new Error('Примите соглашение и политику конфиденциальности');
                }
                const result = await client.register(
                    username.trim(),
                    email.trim().toLowerCase(),
                    password,
                );
                if (!current()) {
                    return;
                }
                const deadline = result.verificationRequired ? Date.now() + 60000 : 0;
                if (result.verificationRequired) {
                    await client.authFlow.save({
                        mode: 'verify',
                        email: email.trim().toLowerCase(),
                        username: username.trim(),
                        resendAt: deadline,
                    });
                    if (!current()) {
                        return;
                    }
                }
                changeMode(result.verificationRequired ? 'verify' : 'login');
                if (result.verificationRequired) {
                    setClock(Date.now());
                    setResendAt(deadline);
                }
                action.setSuccess(
                    result.verificationRequired
                        ? 'Код подтверждения отправлен на почту.'
                        : 'Аккаунт создан. Теперь войдите.',
                );
            } else if (mode === 'verify') {
                await client.verifyEmail(email, confirmationCode(code));
                if (!current()) {
                    return;
                }
                const completedGeneration = ++flowGeneration.current;
                await client.authFlow.clear();
                if (!mounted.current || completedGeneration !== flowGeneration.current) {
                    return;
                }
                setDone(true);
                setCode('');
            } else if (!sent) {
                await client.requestPasswordRecovery(email);
                setSent(true);
                setResendAt(Date.now() + 60000);
            } else {
                const normalizedCode = confirmationCode(code);
                const invalid = passwordError(password);
                if (invalid) {
                    throw new Error(invalid);
                }
                if (password !== repeat) {
                    throw new Error('Пароли не совпадают');
                }
                await client.resetPassword(email, normalizedCode, password);
                setDone(true);
                setPassword('');
                setRepeat('');
            }
        });
    const resend = () =>
        action.run(async () => {
            if (Date.now() < resendAt) {
                throw new Error('Подождите перед повторной отправкой кода.');
            }
            const generation = flowGeneration.current;
            try {
                await client.resendVerification(email);
            } catch (error) {
                if (
                    error instanceof ApiError &&
                    error.retryAfter &&
                    mounted.current &&
                    generation === flowGeneration.current
                ) {
                    setClock(Date.now());
                    setResendAt(Date.now() + error.retryAfter * 1000);
                }
                throw error;
            }
            if (!mounted.current || generation !== flowGeneration.current) {
                return;
            }
            const deadline = Date.now() + 60000;
            await client.authFlow.save({ mode: 'verify', email, username, resendAt: deadline });
            if (!mounted.current || generation !== flowGeneration.current) {
                return;
            }
            setClock(Date.now());
            setResendAt(deadline);
        }, 'Проверьте почту и папку Спам.');

    const resendSeconds = Math.max(0, Math.ceil((resendAt - clock) / 1000));
    return {
        ready,
        mode,
        email,
        setEmail,
        password,
        setPassword,
        repeat,
        setRepeat,
        username,
        setUsername,
        code,
        setCode,
        accepted,
        setAccepted,
        sent,
        done,
        resendSeconds,
        action,
        changeMode,
        submit,
        resend,
        resetRecovery: () => {
            setSent(false);
            setCode('');
        },
    };
}

export type Authentication = ReturnType<typeof useAuthentication>;
