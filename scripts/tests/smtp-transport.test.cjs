const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const net = require("node:net")
const tls = require("node:tls")
const { once } = require("node:events")
const { spawn, execFileSync } = require("node:child_process")

if (process.argv[2] === "--send") {
    require("tsx/cjs")
    const { sendRecoveryMail } = require("../../apps/auth-api/services/recoveryMail.ts")
    sendRecoveryMail("recipient@example.test", "A1B2C3D4E5", process.argv[3], "QA device\r\nInjected header")
        .then(() => console.log(JSON.stringify({ sent: true })))
        .catch(error => { console.log(JSON.stringify({ sent: false, code: error.code, command: error.command, message: error.message })); process.exitCode = 1 })
} else {
    const { test, before, after } = require("node:test")
    let directory, key, cert
    before(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-smtp-tls-"))
        const config = path.join(directory, "certificate.cnf")
        await fs.writeFile(config, "[req]\nprompt=no\ndistinguished_name=subject\nx509_extensions=extensions\n[subject]\nCN=smtp.fixture.test\n[extensions]\nsubjectAltName=DNS:smtp.fixture.test\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n")
        execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-config", config, "-keyout", path.join(directory, "key.pem"), "-out", path.join(directory, "cert.pem")], { stdio: "ignore" })
        key = await fs.readFile(path.join(directory, "key.pem")); cert = await fs.readFile(path.join(directory, "cert.pem"))
    })
    after(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }) })

    async function fixture(t, starttls = true) {
        const sockets = new Set(), messages = [], commands = [], tlsSessions = [], attempts = []
        const state = { reject: false }
        const secureContext = tls.createSecureContext({ key, cert })
        function attach(socket, encrypted = false) {
            sockets.add(socket)
            socket.on("close", () => sockets.delete(socket))
            socket.on("error", () => {})
            let buffer = "", data = false, body = "", authenticated = false
            const onData = chunk => {
                buffer += chunk.toString()
                let offset
                while ((offset = buffer.indexOf("\r\n")) >= 0) {
                    const line = buffer.slice(0, offset); buffer = buffer.slice(offset + 2)
                    if (data) {
                        if (line === ".") {
                            data = false; attempts.push(body)
                            if (!state.reject) messages.push(body)
                            body = ""; socket.write(state.reject ? "550 Fixture temporarily rejects delivery\r\n" : "250 Queued\r\n")
                        } else body += line.replace(/^\.\./, ".") + "\r\n"
                        continue
                    }
                    const command = line.split(" ")[0].toUpperCase()
                    commands.push({ command, encrypted })
                    if (command === "EHLO" || command === "HELO") socket.write(`250-smtp.fixture.test\r\n${!encrypted && starttls ? "250-STARTTLS\r\n" : ""}250 AUTH PLAIN\r\n`)
                    else if (command === "STARTTLS" && starttls && !encrypted) {
                        socket.write("220 Begin TLS\r\n")
                        socket.removeListener("data", onData)
                        const secured = new tls.TLSSocket(socket, { isServer: true, secureContext })
                        secured.on("secure", () => tlsSessions.push({ protocol: secured.getProtocol(), servername: secured.servername }))
                        attach(secured, true)
                        return
                    } else if (command === "STARTTLS") socket.write("502 TLS not available\r\n")
                    else if (command === "AUTH") {
                        const credentials = Buffer.from(line.split(" ")[2] || "", "base64").toString()
                        authenticated = encrypted && credentials === "\0fixture-user\0fixture-password"
                        socket.write(authenticated ? "235 Authenticated\r\n" : "535 Authentication denied\r\n")
                    } else if (command === "MAIL" || command === "RCPT") socket.write(authenticated ? "250 Accepted\r\n" : "530 Authentication required\r\n")
                    else if (command === "DATA") { data = true; socket.write("354 Send message\r\n") }
                    else if (command === "QUIT") socket.end("221 Bye\r\n")
                    else socket.write("250 OK\r\n")
                }
            }
            socket.on("data", onData)
        }
        const server = net.createServer(socket => { attach(socket); socket.write("220 smtp.fixture.test ready\r\n") }).listen(0, "127.0.0.1")
        await once(server, "listening")
        t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)) })
        async function send(purpose, override = {}) {
            const child = spawn(process.execPath, [__filename, "--send", purpose], {
                env: { ...process.env, NODE_ENV: "production", NODE_EXTRA_CA_CERTS: path.join(directory, "cert.pem"), SMTP_HOST: "127.0.0.1", SMTP_PORT: String(server.address().port), SMTP_FROM: "PlayTime <noreply@example.test>", SMTP_TLS_SERVERNAME: "smtp.fixture.test", SMTP_USER: "fixture-user", SMTP_PASSWORD: "fixture-password", ...override },
                stdio: ["ignore", "pipe", "pipe"]
            })
            let output = "", errors = ""
            child.stdout.on("data", data => { output += data }); child.stderr.on("data", data => { errors += data })
            const timeout = setTimeout(() => child.kill("SIGKILL"), 25000)
            const [status] = await once(child, "close"); clearTimeout(timeout)
            assert.ok(output.trim(), `SMTP child returned no result: ${errors}`)
            return { status, ...JSON.parse(output.trim()) }
        }
        return { send, messages, commands, tlsSessions, attempts, state }
    }

    function body(message) {
        const [headers, ...parts] = message.split("\r\n\r\n"), encoded = parts.join("\r\n\r\n")
        return /Content-Transfer-Encoding: base64/i.test(headers)
            ? Buffer.from(encoded.replace(/\s/g, ""), "base64").toString("utf8")
            : Buffer.from(encoded.replace(/=\r\n/g, "").replace(/=([A-F0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), "latin1").toString("utf8")
    }

    test("production mail uses authenticated STARTTLS and delivers all three code purposes", async t => {
        const smtp = await fixture(t)
        for (const purpose of ["verification", "recovery", "session-revocation"]) assert.equal((await smtp.send(purpose)).sent, true)
        assert.equal(smtp.messages.length, 3)
        assert.equal(smtp.tlsSessions.length, 3)
        assert.ok(smtp.tlsSessions.every(session => /^TLSv1\.[23]$/.test(session.protocol) && session.servername === "smtp.fixture.test"))
        assert.ok(smtp.commands.filter(item => ["AUTH", "MAIL", "RCPT", "DATA"].includes(item.command)).every(item => item.encrypted))
        smtp.messages.forEach(message => {
            assert.match(message, /To: recipient@example.test/)
            assert.match(body(message), /A1B2C3D4E5/)
            assert.doesNotMatch(message, /^Injected header/m)
        })
        assert.match(body(smtp.messages[0]), /Код подтверждения почты/)
        assert.match(body(smtp.messages[1]), /Код восстановления/)
        assert.match(body(smtp.messages[2]), /QA device +Injected header/)
    })

    test("production refuses SMTP servers without STARTTLS before sending credentials or mail", async t => {
        const smtp = await fixture(t, false), response = await smtp.send("verification")
        assert.equal(response.sent, false)
        assert.equal(response.command, "STARTTLS")
        assert.equal(smtp.messages.length, 0)
        assert.equal(smtp.commands.some(item => ["AUTH", "MAIL", "DATA"].includes(item.command)), false)
    })

    test("TLS hostname mismatch is rejected before authentication", async t => {
        const smtp = await fixture(t), response = await smtp.send("verification", { SMTP_TLS_SERVERNAME: "wrong.fixture.test" })
        assert.equal(response.sent, false)
        assert.match(response.message, /Hostname\/IP does not match certificate/)
        assert.equal(smtp.messages.length, 0)
        assert.equal(smtp.commands.some(item => item.command === "AUTH"), false)
    })

    test("SMTP rejection propagates and a fresh transport can deliver the retry", async t => {
        const smtp = await fixture(t)
        smtp.state.reject = true
        assert.equal((await smtp.send("verification")).sent, false)
        smtp.state.reject = false
        assert.equal((await smtp.send("verification")).sent, true)
        assert.equal(smtp.attempts.length, 2)
        assert.equal(smtp.messages.length, 1)
    })
}
