import { randomBytes } from "node:crypto"
import { Pool } from "pg"

export { redis } from "./redis"

const {
    PG_USER = "postgres",
    PG_HOST = "localhost",
    PG_DATABASE = "playtime",
    PG_PASSWORD = "",
    PG_PORT = "5432",
    JWT_SECRET_ENV
} = process.env

export const pool = new Pool({
    user: PG_USER,
    host: PG_HOST,
    database: PG_DATABASE,
    password: PG_PASSWORD,
    port: parseInt(PG_PORT, 10),
    application_name: process.env.PG_APPLICATION_NAME || "playtime",
    max: Number(process.env.PG_POOL_MAX) || 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 10000),
    idle_in_transaction_session_timeout: 15000
})

pool.on("error", () => console.error("PostgreSQL idle connection lost"))

export function validateSigningSecret(): void {
    if (!JWT_SECRET || (process.env.NODE_ENV === "production" && JWT_SECRET.length < 32)) {
        throw new Error("Set JWT_SECRET_ENV to a random string of at least 32 characters")
    }
}

const useEphemeralDevSecret =
    process.env.PLAYTIME_ALLOW_DEV_JWT_SECRET === "1" &&
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")

export const JWT_SECRET = JWT_SECRET_ENV?.trim()
    ? JWT_SECRET_ENV
    : useEphemeralDevSecret
      ? randomBytes(32).toString("hex")
      : ""
