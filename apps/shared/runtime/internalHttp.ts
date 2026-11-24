import { createHmac, timingSafeEqual } from "node:crypto"
import { request as httpRequest, type IncomingMessage } from "node:http"
import { request as httpsRequest } from "node:https"
import type { RequestHandler } from "express"
import { resolveClientIp } from "../http/clientIp"
import { moderationHeader } from "./moderationAuth"

export const internalHeader = "x-playtime-internal"
export const gatewayCredentialHeader = "x-playtime-gateway"

const defaultPorts = { AUTH: 1511, CHAT: 1512, ROOM: 1513 } as const
export type ServiceName = keyof typeof defaultPorts

export function configuredServicePort(service: ServiceName): number {
    const port = Number(process.env[`PLAYTIME_${service}_PORT`] || defaultPorts[service])
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid PLAYTIME_${service}_PORT`)
    }
    return port
}

export function configuredServiceUrl(service: ServiceName): URL {
    const setting = `PLAYTIME_${service}_URL`
    const configured = process.env[setting]?.trim()
    if (!configured) return new URL(`http://127.0.0.1:${configuredServicePort(service)}`)
    return serviceOrigin(configured, setting)
}

export function serviceOrigin(configured: string, setting: string): URL {
    try {
        const url = new URL(configured)
        if (
            (url.protocol === "http:" || url.protocol === "https:") &&
            !url.username &&
            !url.password &&
            url.pathname === "/" &&
            !url.search &&
            !url.hash
        )
            return url
    } catch {}
    throw new Error(`${setting} must be an HTTP(S) origin`)
}

export function internalSecret(): string {
    const value = process.env.PLAYTIME_INTERNAL_SECRET
    if (!value || value.length < 32) throw new Error("PLAYTIME_INTERNAL_SECRET must be at least 32 characters")
    return value
}

export function gatewayCredential(service: ServiceName, purpose: "socket" | "reports"): string {
    const name = `PLAYTIME_${service}_RELAY_SECRET`
    const secret = process.env[name]
    if (!secret || secret.length < 32 || secret === process.env.PLAYTIME_INTERNAL_SECRET)
        throw new Error(`Configure a dedicated ${name}`)
    return createHmac("sha256", secret).update(`gateway:${service}:${purpose}`).digest("base64url")
}

export function matchesCredential(supplied: unknown, expected: string): boolean {
    if (typeof supplied !== "string") return false
    const left = Buffer.from(supplied)
    const right = Buffer.from(expected)
    return left.length === right.length && timingSafeEqual(left, right)
}

export function isInternalRequest(req: IncomingMessage): boolean {
    const candidate = req.headers[internalHeader]
    if (typeof candidate !== "string") return false
    const address = req.socket.remoteAddress
    const loopback = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1"
    if (!loopback && process.env.PLAYTIME_INTERNAL_NETWORK !== "1") return false
    return matchesCredential(candidate, internalSecret())
}

export class InternalHttpError extends Error {
    constructor(readonly status: number) {
        super(`Internal call returned HTTP ${status}`)
    }
}

export async function internalJson<T>(
    base: URL,
    path: string,
    body: unknown,
    extraHeaders?: Record<string, string>
): Promise<T> {
    const response = await fetch(new URL(path, base), {
        method: "POST",
        headers: { ...extraHeaders, [internalHeader]: internalSecret(), "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
        redirect: "error"
    })
    if (!response.ok) {
        await response.body?.cancel()
        throw new InternalHttpError(response.status)
    }
    return (response.status === 204 ? undefined : await response.json()) as T
}

const hopHeaders = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
]
const bodyMethods = new Set(["POST", "PUT", "PATCH"])
const framingHeaders = new Set(["host", "content-length"])

function forwardedHeaders(headers: IncomingMessage["headers"]): IncomingMessage["headers"] {
    const result = { ...headers }
    for (const key of [
        ...hopHeaders,
        ...(headers.connection ?? "")
            .toLowerCase()
            .split(",")
            .map((value) => value.trim())
    ]) {
        if (!framingHeaders.has(key)) delete result[key]
    }
    return result
}

export function proxyService(targets: { auth: URL; chat: URL }): RequestHandler {
    return (req, res, next) => {
        const target = /^\/playtime\/auth(?:\/|$)/i.test(req.path)
            ? targets.auth
            : /^\/playtime\/(?:voice|attachments|peers)(?:\/|$)/i.test(req.path)
              ? targets.chat
              : null
        if (!target) return next()

        const length = req.headers["content-length"]
        const transfer = req.headers["transfer-encoding"]
        const chunked = typeof transfer === "string" && transfer.toLowerCase().trim() === "chunked"
        const hasBody = chunked || (length !== undefined && Number(length) > 0)
        if (
            (length !== undefined && !/^\d+$/.test(length)) ||
            (transfer !== undefined && (!chunked || length !== undefined)) ||
            (hasBody && !bodyMethods.has(req.method))
        ) {
            req.resume()
            res.setHeader("Connection", "close")
            return res.sendStatus(400)
        }

        const headers = forwardedHeaders(req.headers)
        if (chunked) headers["transfer-encoding"] = "chunked"
        delete headers[moderationHeader]
        delete headers[gatewayCredentialHeader]
        delete headers.forwarded
        delete headers["x-forwarded-host"]
        headers[internalHeader] = internalSecret()
        headers["x-real-ip"] = resolveClientIp(req)
        headers["x-forwarded-for"] = headers["x-real-ip"]
        headers["x-forwarded-proto"] = req.protocol
        const request = target.protocol === "https:" ? httpsRequest : httpRequest
        const upstream = request(
            target,
            { method: req.method, path: req.originalUrl, headers, agent: false },
            (response) => {
                res.writeHead(response.statusCode ?? 502, forwardedHeaders(response.headers))
                response.on("error", () => res.destroy())
                response.pipe(res)
            }
        )
        upstream.setTimeout(30000, () => upstream.destroy())
        upstream.on("error", () => {
            if (res.headersSent) res.destroy()
            else if (!res.destroyed) res.status(503).json({ error: "Сервис временно недоступен" })
        })
        res.on("close", () => {
            if (!res.writableFinished) upstream.destroy()
        })
        if (hasBody) req.pipe(upstream)
        else upstream.end()
    }
}
