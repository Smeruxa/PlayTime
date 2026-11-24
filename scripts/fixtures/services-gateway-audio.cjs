const assert = require("node:assert/strict")
const { setTimeout: delay } = require("node:timers/promises")
const { chromium } = require("playwright")

async function verifyGatewayAudio(iceConfigurations, exchangeSignal, duringCall) {
    const browser = await chromium.launch({
        executablePath: process.env.WEB_BROWSER_PATH,
        args: ["--autoplay-policy=no-user-gesture-required"]
    })
    try {
        const page = await browser.newPage()
        const origin = "http://127.0.0.1/"
        await page.route(origin, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }))
        await page.goto(origin)
        await page.evaluate(async (configurations) => {
            const audio = new AudioContext()
            await audio.resume()
            window.peers = [440, 880].map((frequency, index) => {
                const connection = new RTCPeerConnection({
                    iceServers: configurations[index],
                    iceTransportPolicy: "relay"
                })
                const source = audio.createOscillator()
                const destination = audio.createMediaStreamDestination()
                const gain = audio.createGain()
                source.frequency.value = frequency
                gain.gain.value = 0.1
                source.connect(gain).connect(destination)
                source.start()
                connection.addTrack(destination.stream.getAudioTracks()[0], destination.stream)
                return connection
            })
        }, iceConfigurations)

        const getLocalDescription = (index, type, remoteDescription, iceRestart = false) =>
            page.evaluate(
                async ({ index, type, remoteDescription, iceRestart }) => {
                    const connection = window.peers[index]
                    if (remoteDescription) await connection.setRemoteDescription(remoteDescription)
                    const description = await (type === "offer" ? connection.createOffer({ iceRestart }) : connection.createAnswer())
                    await connection.setLocalDescription(description)
                    const gathered = () => connection.iceGatheringState === "complete" &&
                        /a=candidate:[^\r\n]+ typ relay/.test(connection.localDescription?.sdp ?? "")
                    if (!gathered()) {
                        await new Promise((resolve, reject) => {
                            const cleanup = () => {
                                clearTimeout(timeout)
                                connection.removeEventListener("icegatheringstatechange", finish)
                                connection.removeEventListener("icecandidate", finish)
                            }
                            const finish = () => {
                                if (!gathered()) return
                                cleanup()
                                resolve()
                            }
                            const timeout = setTimeout(() => {
                                cleanup()
                                reject(new Error("ICE relay gathering timed out"))
                            }, 5000)
                            connection.addEventListener("icegatheringstatechange", finish)
                            connection.addEventListener("icecandidate", finish)
                            finish()
                        })
                    }
                    return connection.localDescription.toJSON()
                },
                { index, type, remoteDescription, iceRestart }
            )

        async function exchangeDescriptions(iceRestart = false) {
            const offer = await getLocalDescription(0, "offer", undefined, iceRestart)
            assert.match(offer.sdp, /a=candidate:[^\r\n]+ typ relay/, "Caller allocated a TURN relay")
            const relayedOffer = await exchangeSignal(0, offer)
            const answer = await getLocalDescription(1, "answer", relayedOffer)
            assert.match(answer.sdp, /a=candidate:[^\r\n]+ typ relay/, "Callee allocated a TURN relay")
            const relayedAnswer = await exchangeSignal(1, answer)
            await page.evaluate((description) => window.peers[0].setRemoteDescription(description), relayedAnswer)
            await page.waitForFunction(
                () => window.peers.every((connection) => connection.connectionState === "connected"),
                undefined,
                { timeout: 10000 }
            )
        }
        const sampleAudio = () => page.evaluate(async () =>
            Promise.all(window.peers.map(async (connection) => {
                const stats = await connection.getStats()
                const counts = { packets: 0, bytes: 0 }
                for (const entry of stats.values()) {
                    if (entry.type === "inbound-rtp" && entry.kind === "audio") {
                        counts.packets += entry.packetsReceived
                        counts.bytes += entry.bytesReceived
                    }
                }
                return counts
            }))
        )

        await exchangeDescriptions()
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
            const received = await sampleAudio()
            if (received.every(({ packets, bytes }) => packets >= 10 && bytes > 0)) {
                await duringCall?.({ sampleAudio, restartIce: () => exchangeDescriptions(true) })
                return
            }
            await delay(100)
        }
        throw new Error("No bidirectional audio RTP received")
    } finally {
        await browser.close()
    }
}

module.exports = { verifyGatewayAudio }
