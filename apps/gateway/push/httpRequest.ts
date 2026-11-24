import { readFileSync } from "node:fs"
import { request } from "node:https"
import path from "node:path"
import { rootCertificates } from "node:tls"

export type PushRequest = (
    url: string,
    options: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

let certificates: string[] | undefined

export const pushHttpRequest: PushRequest = (url, options) => {
    certificates ??= [
        ...rootCertificates,
        readFileSync(path.join(__dirname, "certificates/russian-trusted-root-ca.pem"), "utf8")
    ]
    return new Promise((resolve, reject) => {
        const outgoing = request(url, { ...options, ca: certificates }, (incoming) => {
            const chunks: Buffer[] = []
            let bytes = 0
            incoming.on("data", (chunk: Buffer) => {
                bytes += chunk.length
                if (bytes > 64 * 1024) {
                    outgoing.destroy(new Error("Push response exceeds the size limit"))
                    return
                }
                chunks.push(chunk)
            })
            incoming.on("error", reject)
            incoming.on("end", () => {
                const status = incoming.statusCode ?? 0
                const body = Buffer.concat(chunks).toString("utf8")
                resolve({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body) as unknown })
            })
        })
        outgoing.on("error", reject)
        outgoing.end(options.body)
    })
}
