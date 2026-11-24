export type PushStatus = 'disabled' | 'checking' | 'ready' | 'unavailable' | 'retrying';

export type PushContext = {
    userId: number | null;
    sessionKey: string | null;
    enabled: boolean;
    mutedChats: string[];
    activeChatKey: string | null;
};

export type PushToken = { available: boolean; token: string | null; reason?: string };

export interface PushRegistrationDependencies {
    getToken(): Promise<PushToken>;
    reconcileAccount(userId: number | null): Promise<unknown>;
    setContext(context: Omit<PushContext, 'sessionKey'>): Promise<unknown>;
    register(
        userId: number,
        body: { provider: 'rustore'; token: string; enabled: boolean; mutedChats: string[] },
    ): Promise<{ registered: boolean; deliveryReady: boolean }>;
    unregister(userId: number): Promise<unknown>;
}

const emptyContext: PushContext = {
    userId: null,
    sessionKey: null,
    enabled: false,
    mutedChats: [],
    activeChatKey: null,
};

export class PushRegistration {
    status: PushStatus = 'disabled';
    private context: PushContext = emptyContext;
    private listeners = new Set<() => void>();
    private revision = 0;
    private running: Promise<void> | null = null;
    private requested = false;
    private registeredSignature: string | null = null;
    private disposed = false;
    private accountRestored = false;
    private preferencesReady = false;

    constructor(private readonly dependencies: PushRegistrationDependencies) {}

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    private setStatus(status: PushStatus): void {
        if (this.status === status || this.disposed) {
            return;
        }
        this.status = status;
        this.listeners.forEach((listener) => listener());
    }

    restoreAccount(userId: number | null, sessionKey: string | null): void {
        if (this.disposed) {
            return;
        }
        if (this.accountRestored && this.context.userId === userId) {
            if (this.context.sessionKey !== sessionKey) {
                if (this.preferencesReady) {
                    this.update({ ...this.context, sessionKey });
                } else {
                    this.context = { ...this.context, sessionKey };
                    this.revision++;
                }
            }
            return;
        }
        this.accountRestored = true;
        this.preferencesReady = false;
        this.context = { ...emptyContext, userId, sessionKey };
        this.revision++;
        this.registeredSignature = null;
        void this.dependencies.reconcileAccount(userId).catch(() => undefined);
        this.setStatus(userId ? 'checking' : 'disabled');
    }

    update(context: PushContext): void {
        if (this.disposed) {
            return;
        }
        const next = {
            ...context,
            enabled: !!context.userId && context.enabled,
            mutedChats: [...new Set(context.mutedChats)].sort(),
        };
        if (this.preferencesReady && JSON.stringify(next) === JSON.stringify(this.context)) {
            return;
        }
        const previous = this.context;
        this.accountRestored = true;
        this.preferencesReady = true;
        this.context = next;
        this.revision++;
        void this.dependencies
            .setContext({
                userId: next.userId,
                enabled: next.enabled,
                mutedChats: next.mutedChats,
                activeChatKey: next.activeChatKey,
            })
            .catch(() => undefined);
        if (previous.sessionKey !== next.sessionKey) {
            this.registeredSignature = null;
        }
        if (!next.enabled) {
            this.setStatus('disabled');
        }
        void this.refresh();
    }

    refresh(): Promise<void> {
        if (this.disposed) {
            return Promise.resolve();
        }
        this.requested = true;
        if (!this.running) {
            this.running = this.drain().finally(() => {
                this.running = null;
            });
        }
        return this.running;
    }

    private async drain(): Promise<void> {
        while (this.requested && !this.disposed) {
            this.requested = false;
            const revision = this.revision;
            const context = this.context;
            try {
                await this.synchronize(context, revision);
            } catch {
                if (revision === this.revision && context.enabled) {
                    this.setStatus('retrying');
                }
            }
        }
    }

    private async synchronize(context: PushContext, revision: number): Promise<void> {
        if (!this.preferencesReady || !context.userId || !context.sessionKey) {
            return;
        }
        if (!context.enabled) {
            const signature = `disabled:${context.sessionKey}`;
            if (this.registeredSignature === signature) {
                return;
            }
            await this.dependencies.unregister(context.userId);
            if (revision === this.revision) {
                this.registeredSignature = signature;
            }
            return;
        }
        this.setStatus('checking');
        const token = await this.dependencies.getToken();
        if (revision !== this.revision || this.disposed) {
            return;
        }
        if (!token.available || !token.token) {
            this.setStatus('unavailable');
            return;
        }
        const body = {
            provider: 'rustore' as const,
            token: token.token,
            enabled: true,
            mutedChats: context.mutedChats,
        };
        const signature = JSON.stringify([context.sessionKey, body]);
        if (signature === this.registeredSignature) {
            this.setStatus('ready');
            return;
        }
        const response = await this.dependencies.register(context.userId, body);
        if (revision !== this.revision || this.disposed) {
            return;
        }
        if (!response.registered || !response.deliveryReady) {
            this.setStatus('unavailable');
            return;
        }
        this.registeredSignature = signature;
        this.setStatus('ready');
    }

    dispose(): void {
        this.disposed = true;
        this.revision++;
        this.listeners.clear();
    }
}
