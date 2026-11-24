export type AudioProgress = {
    positionMs: number;
    durationMs: number;
    playing: boolean;
};

export type AudioState = AudioProgress & {
    owner: string | null;
    loading: boolean;
    error: string;
};

export interface AudioDriver {
    playAudio(uri: string): Promise<boolean>;
    pauseAudio(): Promise<boolean>;
    resumeAudio(): Promise<boolean>;
    stopAudio(): Promise<boolean>;
    seekAudio(positionMs: number): Promise<boolean>;
    getAudioProgress(): Promise<AudioProgress>;
}

const empty: AudioState = {
    owner: null,
    loading: false,
    playing: false,
    positionMs: 0,
    durationMs: 0,
    error: '',
};

export class AudioPlayback {
    private state: AudioState = empty;
    private listeners = new Set<() => void>();
    private generation = 0;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly driver: AudioDriver) {}

    getSnapshot = (): AudioState => this.state;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    private patch(value: Partial<AudioState>): void {
        this.state = { ...this.state, ...value };
        this.listeners.forEach((listener) => listener());
    }

    private enqueue(operation: () => Promise<unknown>): Promise<void> {
        const pending = this.queue.catch(() => undefined).then(operation);
        this.queue = pending;
        return pending.then(() => undefined);
    }

    async toggle(owner: string, load: () => Promise<string>, durationMs: number): Promise<void> {
        if (this.state.owner === owner && !this.state.loading && !this.state.error) {
            const generation = this.generation;
            return this.enqueue(async () => {
                if (generation !== this.generation) {
                    return;
                }
                if (this.state.playing) {
                    await this.driver.pauseAudio();
                    this.patch({ playing: false });
                    return;
                }
                if (this.state.positionMs >= this.state.durationMs) {
                    await this.driver.seekAudio(0);
                }
                if (!(await this.driver.resumeAudio())) {
                    throw new Error('Не удалось продолжить воспроизведение');
                }
                this.patch({ playing: true, error: '' });
            }).catch((error: unknown) => this.fail(owner, error));
        }

        const generation = ++this.generation;
        this.patch({ ...empty, owner, loading: true, durationMs });
        try {
            await this.enqueue(() => this.driver.stopAudio());
            const uri = await load();
            if (generation !== this.generation) {
                return;
            }
            await this.enqueue(async () => {
                if (generation !== this.generation) {
                    return;
                }
                await this.driver.playAudio(uri);
                if (generation === this.generation) {
                    this.patch({ playing: true, loading: false });
                }
            });
        } catch (error) {
            if (generation === this.generation) {
                this.fail(owner, error);
            }
        }
    }

    private fail(owner: string, error: unknown): never {
        if (this.state.owner === owner) {
            this.patch({
                owner: null,
                loading: false,
                playing: false,
                error: error instanceof Error ? error.message : 'Не удалось воспроизвести запись',
            });
        }
        throw error;
    }

    async seek(owner: string, fraction: number): Promise<void> {
        if (this.state.owner !== owner || this.state.loading) {
            return;
        }
        const generation = this.generation;
        const position = Math.max(0, Math.min(1, fraction)) * this.state.durationMs;
        this.patch({ positionMs: position });
        await this.enqueue(async () => {
            if (generation === this.generation) {
                await this.driver.seekAudio(position);
            }
        });
    }

    async stop(owner?: string): Promise<void> {
        if (owner && this.state.owner !== owner) {
            return;
        }
        ++this.generation;
        this.patch(empty);
        await this.enqueue(() => this.driver.stopAudio());
    }

    async poll(): Promise<void> {
        if (!this.state.playing || this.state.loading) {
            return;
        }
        const generation = this.generation;
        try {
            const progress = await this.driver.getAudioProgress();
            if (generation === this.generation) {
                this.patch(progress);
            }
        } catch {
            if (generation === this.generation) {
                this.patch({ playing: false, error: 'Воспроизведение прервано' });
            }
        }
    }

    interrupted(): void {
        this.patch({ playing: false });
    }

    ended(error?: string): void {
        this.patch({
            playing: false,
            loading: false,
            positionMs: error ? this.state.positionMs : this.state.durationMs,
            error: error || '',
        });
    }
}
