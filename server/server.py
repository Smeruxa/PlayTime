import asyncio
import json

clients = {}
lock = asyncio.Lock()

class VoiceServerProtocol(asyncio.DatagramProtocol):
    def connection_made(self, transport):
        self.transport = transport

    async def broadcast(self, message, sender_addr):
        response = json.dumps(message).encode()
        async with lock:
            stale_clients = set()
            for client_addr in clients:
                if client_addr != sender_addr:
                    try:
                        self.transport.sendto(response, client_addr)
                    except OSError:
                        stale_clients.add(client_addr)
            for client in stale_clients:
                del clients[client]

    def datagram_received(self, data, addr):
        try:
            message = json.loads(data.decode())
            if addr not in clients:
                clients[addr] = len(clients) + 1

            user_id = clients[addr]
            clients[addr] = user_id

            asyncio.create_task(self.broadcast({
                "type": "voice",
                "user_id": user_id,
                "timestamp": message["timestamp"],
                "message": message["message"]
            }, addr))
        except json.JSONDecodeError:
            pass

async def main():
    loop = asyncio.get_running_loop()
    transport, protocol = await loop.create_datagram_endpoint(
        lambda: VoiceServerProtocol(), local_addr=('92.53.107.231', 8653)
    )
    try:
        await asyncio.Future()
    except asyncio.CancelledError:
        transport.close()

asyncio.run(main())