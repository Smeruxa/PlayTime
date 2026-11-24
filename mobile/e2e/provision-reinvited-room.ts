import { PlayTimeClient } from '../src/services/client';
import type { SecureStorage } from '../src/services/storage';
import { b64 } from '../src/services/crypto';

class TestStorage implements SecureStorage {
    values = new Map<string, string>();
    async get(key: string) {
        return this.values.get(key) ?? null;
    }
    async set(key: string, value: string) {
        this.values.set(key, value);
    }
    async remove(key: string) {
        this.values.delete(key);
    }
}
const delay = () => new Promise((resolve) => setTimeout(resolve, 30));
async function main() {
    const storage = new TestStorage();
    storage.values.set('keys.2', JSON.stringify({ dm: b64(new Uint8Array(32).fill(2)) }));
    const options = {
        baseUrl: 'http://127.0.0.1:1502/playtime',
        socketUrl: 'http://127.0.0.1:1502',
        timeoutMs: 3000,
    };
    const owner = new PlayTimeClient({ ...options, storage: new TestStorage() });
    const member = new PlayTimeClient({ ...options, storage });
    try {
        await owner.login('mika@example.test', 'PlayTime-test-123');
        for (let i = 0; i < 200 && owner.snapshot.connection !== 'online'; i++) await delay();
        await owner.transferRoomOwnership(10, 2);
        await member.login('nova@example.test', 'PlayTime-test-123');
        for (let i = 0; i < 200 && !member.snapshot.encryption.ready; i++) await delay();
        await member.openChat({ id: 10, name: 'Вечерний пати', isRoom: true, createdBy: 2 });
        await member.removeRoomMember(10, 1);
        await member.addRoomMembers(10, ['Mika']);
        for (let i = 0; i < 200; i++) {
            const bundle = await owner.ack<{ myWrap: unknown }>('room:e2eeBundle', { roomId: 10 });
            if (bundle.myWrap) {
                console.log('Existing Nova member provisioned the reinvited current Mika identity');
                return;
            }
            await delay();
        }
        throw new Error('Existing member did not provision the reinvited identity');
    } finally {
        owner.dispose();
        member.dispose();
    }
}
void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
