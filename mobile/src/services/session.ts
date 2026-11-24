import type { FeatureHost } from './featureHost';
import type { ClientSnapshot, Session } from '../types';
import type { ClientOptions } from './client';
import { ApiError, requestJson, type RequestOptions } from './http';
import { nativeBridge } from './nativeBridge';
import { initialSnapshot } from './snapshot';
import { text, unb64 } from './crypto';
import { confirmationCode } from './confirmationCode';
import { PRODUCTION_ORIGIN } from './storageScope';
export interface SessionHost extends FeatureHost {
    clearAuthFlow(): Promise<void>;
    connect(): void;
    disconnect(): void;
    clearError(): void;
    resetChat(): void;
    clearHomeRequest(): void;
    replaceSnapshot(snapshot: ClientSnapshot): void;
}
export class SessionService {
    baseUrl: string;
    socketUrl: string;
    generation = 0;
    private configured: Promise<void> | null = null;
    private refreshPromise: Promise<boolean> | null = null;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;
    private sessionWrites: Promise<void> = Promise.resolve();
    constructor(private host: SessionHost, private options: ClientOptions) {
        this.baseUrl = (options.baseUrl ?? `${PRODUCTION_ORIGIN}/playtime`).replace(/\/$/, '');
        this.socketUrl = (options.socketUrl ?? PRODUCTION_ORIGIN).replace(/\/$/, '');
    }
    clearRefreshTimer(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = null;
    }
    async configure(): Promise<void> {
        if (!this.configured) {
            this.configured = (async () => {
                if (typeof __DEV__ !== 'undefined' && __DEV__ && !this.options.baseUrl) {
                    const native = await nativeBridge();
                    if (typeof native?.apiBase === 'string') {
                        this.baseUrl = native.apiBase.replace(/\/$/, '');
                    }
                    if (typeof native?.socketUrl === 'string') {
                        this.socketUrl = native.socketUrl.replace(/\/$/, '');
                    }
                }
            })();
        }
        return this.configured;
    }

    persistSession(session: Session | null): Promise<void> {
        const work = this.sessionWrites
            .catch(() => {})
            .then(() =>
                session
                    ? this.host.storage.set('session', JSON.stringify(session))
                    : this.host.storage.remove('session'),
            );
        this.sessionWrites = work;
        return work;
    }

    async request<T = Record<string, unknown>>(
        path: string,
        options: RequestOptions = {},
    ): Promise<T> {
        await this.configure();
        if (!path.startsWith('/') || path.startsWith('//')) {
            throw new Error('Некорректный адрес запроса');
        }
        if (options.auth !== false && !this.host.snapshot.session) {
            throw new ApiError('Сначала войдите в аккаунт', 401);
        }
        if (
            options.expectedUserId !== undefined &&
            this.host.snapshot.session?.user.id !== options.expectedUserId
        ) {
            throw new Error('Сеанс изменился. Повторите действие.');
        }
        const generation = this.generation;
        const execute = () =>
            requestJson(
                `${this.baseUrl}${path}`,
                options,
                options.auth !== false ? this.host.snapshot.session?.token : undefined,
                this.options.fetch ?? fetch,
                this.options.timeoutMs ?? 20000,
            );
        let { response, body } = await execute();
        if (
            response.status === 401 &&
            options.auth !== false &&
            generation === this.generation &&
            (await this.refreshAccess())
        ) {
            ({ response, body } = await execute());
        }
        if (!response.ok) {
            throw new ApiError(
                typeof body.error === 'string' ? body.error : 'Сервер временно недоступен',
                response.status,
                body.verificationRequired === true,
                typeof body.retryAfter === 'number' ? body.retryAfter : undefined,
            );
        }
        if (options.auth !== false && generation !== this.generation) {
            throw new Error('Сеанс изменился. Повторите действие.');
        }
        return body as T;
    }

    assertSession(): Session {
        if (!this.host.snapshot.session) {
            throw new Error('Сначала войдите в аккаунт');
        }
        return this.host.snapshot.session;
    }

    async bootstrap(): Promise<void> {
        const generation = ++this.generation;
        this.host.update({ bootstrapping: true, error: null });
        try {
            await this.configure();
            const raw = await this.host.storage.get('session');
            if (generation !== this.generation) {
                return;
            }
            if (!raw) {
                return;
            }
            await this.host.clearAuthFlow();
            if (generation !== this.generation) {
                return;
            }
            const session = JSON.parse(raw) as Session;
            if (
                !session?.token ||
                !session.refreshToken ||
                !Number.isSafeInteger(session.user?.id)
            ) {
                await this.persistSession(null);
                return;
            }
            this.host.update({ session });
            await this.host.vault.load(session.user.id);
            const validity = await this.request<{
                valid: boolean;
                user: { id: number; username: string };
            }>('/auth/tokenValid', { body: { token: session.token }, auth: false }).catch(
                async (error) => {
                    if (error instanceof ApiError && [401, 403].includes(error.status)) {
                        if (await this.refreshAccess()) {
                            return { valid: true, user: this.assertSession().user };
                        }
                    }
                    throw error;
                },
            );
            if (generation !== this.generation || !validity.valid) {
                return;
            }
            this.host.connect();
            this.scheduleRefresh();
        } catch (error) {
            if (generation !== this.generation) {
                return;
            }
            if (error instanceof ApiError && [401, 403].includes(error.status)) {
                await this.clearSession();
            } else {
                this.host.report(error);
            }
        } finally {
            if (generation === this.generation) {
                this.host.update({ bootstrapping: false });
            }
        }
    }

    async login(email: string, password: string): Promise<void> {
        const generation = ++this.generation;
        const result = await this.request<Session>('/auth/login', {
            auth: false,
            body: { email: email.trim().toLowerCase(), password },
        });
        if (generation !== this.generation) {
            void this.revokeCredentials(result);
            return;
        }
        if (!result.token || !result.refreshToken || !result.user?.id) {
            throw new Error('Сервер вернул некорректную сессию');
        }
        this.host.disconnect();
        await this.host.clearAuthFlow();
        if (generation !== this.generation) {
            void this.revokeCredentials(result);
            return;
        }
        await this.persistSession(result);
        if (generation !== this.generation) {
            void this.revokeCredentials(result);
            return;
        }
        await this.host.vault.load(result.user.id);
        if (generation !== this.generation) {
            return;
        }
        this.host.replaceSnapshot({ ...initialSnapshot(), bootstrapping: false, session: result });
        this.host.update({ connection: 'connecting' });
        this.host.connect();
        this.scheduleRefresh();
    }

    register(
        username: string,
        email: string,
        password: string,
    ): Promise<{ verificationRequired: boolean }> {
        return this.request('/auth/register', {
            auth: false,
            body: { username: username.trim(), email: email.trim().toLowerCase(), password },
        });
    }

    async verifyEmail(email: string, code: string): Promise<void> {
        await this.request('/auth/email-verification/confirm', {
            auth: false,
            body: { email: email.trim().toLowerCase(), code: confirmationCode(code) },
        });
    }

    async resendVerification(email: string): Promise<void> {
        await this.request('/auth/email-verification/request', {
            auth: false,
            body: { email: email.trim().toLowerCase() },
        });
    }

    async requestPasswordRecovery(email: string): Promise<void> {
        await this.request('/auth/recovery/request', {
            auth: false,
            body: { email: email.trim().toLowerCase() },
        });
    }

    async resetPassword(email: string, code: string, password: string): Promise<void> {
        await this.request('/auth/recovery/reset', {
            auth: false,
            body: { email: email.trim().toLowerCase(), code: confirmationCode(code), password },
        });
    }

    async revokeCredentials(session: Session): Promise<void> {
        await this.request('/auth/revoke', {
            auth: false,
            body: { token: session.token, refreshToken: session.refreshToken },
        }).catch(() => {});
    }

    async clearSession(): Promise<void> {
        this.generation++;
        const clearAuthFlow = this.host.clearAuthFlow();
        this.host.resetChat();
        this.host.disconnect();
        this.host.vault.clear();

        this.host.clearHomeRequest();
        this.host.replaceSnapshot({ ...initialSnapshot(), bootstrapping: false });
        this.host.update({});
        await Promise.all([clearAuthFlow, this.persistSession(null)]);
    }

    async logout(): Promise<void> {
        const session = this.host.snapshot.session;
        await this.clearSession();
        if (session) {
            void this.revokeCredentials(session);
        }
    }

    scheduleRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        const session = this.host.snapshot.session;
        if (!session) {
            return;
        }
        let expires = Date.now() + (session.expiresIn || 900) * 1000;
        try {
            const raw = session.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(text(unb64(raw.padEnd(Math.ceil(raw.length / 4) * 4, '='))));
            if (typeof payload.exp === 'number') {
                expires = payload.exp * 1000;
            }
        } catch {}
        this.refreshTimer = setTimeout(() => {
            void this.refreshAccess().then((ok) => {
                if (!ok && this.host.snapshot.session) {
                    this.refreshTimer = setTimeout(() => {
                        void this.refreshAccess();
                    }, 15000);
                }
            });
        }, Math.max(5000, expires - Date.now() - 90000));
    }

    async refreshAccess(): Promise<boolean> {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        const current = this.host.snapshot.session;
        if (!current) {
            return false;
        }
        const generation = this.generation;
        const work = (async () => {
            try {
                const next = await this.request<Session>('/auth/refresh', {
                    auth: false,
                    body: { refreshToken: current.refreshToken },
                });
                if (
                    generation !== this.generation ||
                    this.host.snapshot.session?.refreshToken !== current.refreshToken
                ) {
                    void this.revokeCredentials(next);
                    return false;
                }
                await this.persistSession(next);
                if (generation !== this.generation) {
                    void this.revokeCredentials(next);
                    return false;
                }
                this.host.update({ session: next });
                if (this.host.socket?.connected) {
                    this.host.socket.emit('auth:refresh', {
                        token: next.token,
                        peerIdentityProtocol: 1,
                    });
                } else {
                    this.host.socket?.connect();
                }
                this.scheduleRefresh();
                return true;
            } catch (error) {
                if (generation !== this.generation) {
                    return false;
                }
                if (error instanceof ApiError && [401, 403].includes(error.status)) {
                    await this.clearSession();
                }
                return false;
            }
        })();
        this.refreshPromise = work;
        try {
            return await work;
        } finally {
            if (this.refreshPromise === work) {
                this.refreshPromise = null;
            }
        }
    }

    async reconnect(): Promise<void> {
        await this.configure();
        this.host.clearError();
        if (!this.host.snapshot.session) {
            await this.bootstrap();
            return;
        }
        if (!this.host.socket) {
            this.host.connect();
        } else {
            this.host.socket.connect();
        }
        if (this.host.socket?.connected) {
            await this.host.refreshHome();
        }
    }
}
