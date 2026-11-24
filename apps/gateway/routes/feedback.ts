import express from "express"
import { pool, redis } from "../../shared/config"
import { resolveClientIp } from "../../shared/http/clientIp"
import { adminSessionMiddleware } from "../middlewares/adminSessionMiddleware"
import { adminWriteMiddleware } from "../middlewares/adminWriteMiddleware"
import {
    FEEDBACK_BUDGET_SCRIPT,
    FEEDBACK_COOLDOWN_SECONDS,
    feedbackIpHash,
    issueFeedbackToken,
    verifyFeedbackToken
} from "../feedback/abuse"

const router = express.Router()
const statuses = ["new", "planned", "in_progress", "done", "declined", "spam"]
const priorities = ["low", "normal", "high"]
const kinds = ["feature", "bug"]
const publicColumns =
    "id, kind, title, description, contact, app_version, platform, status, priority, internal_note, revision, created_at, updated_at"
function clean(value: unknown, max: number): string | null {
    return typeof value === "string" &&
        value.length <= max &&
        !Array.from(value).some((char) => {
            const code = char.charCodeAt(0)
            return code === 127 || (code < 32 && ![9, 10, 13].includes(code))
        })
        ? value.trim()
        : null
}
function retry(res: express.Response, seconds: number) {
    res.setHeader("Retry-After", String(seconds))
    return res
        .status(429)
        .json({ error: "Заявка уже отправлена или запросов слишком много. Попробуйте позже.", retryAfter: seconds })
}
router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store")
    try {
        const ipHash = feedbackIpHash(resolveClientIp(req))
        res.locals.feedbackIpHash = ipHash
        const wait = Number(
            await redis.eval(FEEDBACK_BUDGET_SCRIPT, 2, "feedback:budget:global", `feedback:budget:${ipHash}`)
        )
        if (wait > 0) return retry(res, wait)
        next()
    } catch {
        res.status(503).json({ error: "Форма временно недоступна. Попробуйте позже." })
    }
})
router.use(express.json({ limit: "24kb", strict: true }))
router.get("/challenge", (_req, res) => {
    res.json({ token: issueFeedbackToken(res.locals.feedbackIpHash), cooldownSeconds: FEEDBACK_COOLDOWN_SECONDS })
})
router.post("/tickets", async (req, res) => {
    const title = clean(req.body?.title, 120),
        description = clean(req.body?.description, 6000)
    const contact = clean(req.body?.contact ?? "", 160),
        version = clean(req.body?.appVersion ?? "", 40)
    const platform = clean(req.body?.platform ?? "", 40),
        kind = req.body?.kind
    if (
        !kinds.includes(kind) ||
        !title ||
        title.length < 5 ||
        !description ||
        description.length < 20 ||
        contact === null ||
        version === null ||
        platform === null
    ) {
        return res.status(400).json({ error: "Укажите тему (5–120 символов) и описание (20–6000 символов)." })
    }
    const ipHash = res.locals.feedbackIpHash as string
    if (req.body?.website || !verifyFeedbackToken(req.body?.token, ipHash)) {
        return res
            .status(400)
            .json({ error: "Обновите форму и повторите отправку через несколько секунд.", refreshChallenge: true })
    }
    let client
    try {
        const ttl = await redis.ttl(`feedback:submitted:${ipHash}`)
        if (ttl > 0) return retry(res, ttl)
        client = await pool.connect()
        await client.query("BEGIN")
        const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked", [
            `feedback:${ipHash}`
        ])
        if (!lock.rows[0]?.locked) {
            await client.query("ROLLBACK")
            return retry(res, 3)
        }
        const recent = await client.query(
            "SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM created_at + INTERVAL '15 minutes' - NOW())))::int AS retry_after FROM feedback_tickets WHERE ip_hash=$1 AND created_at > NOW() - INTERVAL '15 minutes' ORDER BY created_at DESC LIMIT 1",
            [ipHash]
        )
        if (recent.rows.length) {
            await client.query("ROLLBACK")
            return retry(res, Number(recent.rows[0].retry_after))
        }
        const inserted = await client.query(
            "INSERT INTO feedback_tickets(kind,title,description,contact,app_version,platform,ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            [kind, title, description, contact, version, platform, ipHash]
        )
        await client.query("COMMIT")
        try {
            await redis.set(`feedback:submitted:${ipHash}`, "1", "EX", FEEDBACK_COOLDOWN_SECONDS)
        } catch {
        }
        res.status(201).json({ id: String(inserted.rows[0].id), cooldownSeconds: FEEDBACK_COOLDOWN_SECONDS })
    } catch {
        if (client) await client.query("ROLLBACK").catch(() => {})
        res.status(503).json({ error: "Не удалось отправить заявку. Попробуйте позже." })
    } finally {
        client?.release()
    }
})
router.use(
    (
        error: { type?: string; status?: number },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
    ) => {
        res.status(error.type === "entity.too.large" ? 413 : 400).json({
            error:
                error.type === "entity.too.large"
                    ? "Заявка слишком большая. Сократите описание."
                    : "Некорректный запрос."
        })
    }
)

export const feedbackAdminRouter = express.Router()
feedbackAdminRouter.use(adminSessionMiddleware, adminWriteMiddleware)
feedbackAdminRouter.get("/", async (req, res) => {
    const status = clean(req.query.status ?? "", 20),
        kind = clean(req.query.kind ?? "", 20),
        priority = clean(req.query.priority ?? "", 20)
    const search = clean(req.query.search ?? "", 100)
    const before = typeof req.query.before === "string" && /^\d{1,18}$/.test(req.query.before) ? req.query.before : null
    if (
        status === null ||
        kind === null ||
        priority === null ||
        search === null ||
        (status && !statuses.includes(status)) ||
        (kind && !kinds.includes(kind)) ||
        (priority && !priorities.includes(priority))
    )
        return res.status(400).json({ error: "Некорректный фильтр" })
    const values: unknown[] = []
    const where: string[] = []
    for (const [column, value] of [
        ["status", status],
        ["kind", kind],
        ["priority", priority]
    ] as const) {
        if (value) {
            values.push(value)
            where.push(`${column}=$${values.length}`)
        }
    }
    if (before) {
        values.push(before)
        where.push(`id < $${values.length}`)
    }
    if (search) {
        values.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`)
        where.push(
            `(title ILIKE $${values.length} OR description ILIKE $${values.length} OR contact ILIKE $${values.length} OR id::text ILIKE $${values.length})`
        )
    }
    try {
        const result = await pool.query(
            `SELECT ${publicColumns} FROM feedback_tickets ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT 31`,
            values
        )
        const tickets = result.rows.slice(0, 30)
        res.json({ tickets, nextCursor: result.rows.length > 30 ? String(tickets[tickets.length - 1].id) : null })
    } catch {
        res.status(503).json({ error: "Не удалось загрузить заявки" })
    }
})
feedbackAdminRouter.patch("/:id", async (req, res) => {
    const note = clean(req.body?.internalNote, 4000)
    if (
        !/^\d{1,18}$/.test(req.params.id) ||
        !statuses.includes(req.body?.status) ||
        !priorities.includes(req.body?.priority) ||
        note === null ||
        !Number.isSafeInteger(req.body?.revision) ||
        req.body.revision < 1
    )
        return res.status(400).json({ error: "Некорректные данные заявки" })
    let client
    try {
        client = await pool.connect()
        await client.query("BEGIN")
        const changed = await client.query(
            `UPDATE feedback_tickets SET status=$2, priority=$3, internal_note=$4, revision=revision+1, updated_at=NOW() WHERE id=$1 AND revision=$5 RETURNING ${publicColumns}`,
            [req.params.id, req.body.status, req.body.priority, note, req.body.revision]
        )
        if (!changed.rows.length) {
            await client.query("ROLLBACK")
            return res.status(409).json({ error: "Заявка уже изменена. Обновите список и откройте её снова." })
        }
        await client.query(
            "INSERT INTO admin_audit_log(admin_user_id, action, target_user_id, details) VALUES (NULL, 'ticket.update', NULL, $1)",
            [
                JSON.stringify({
                    ticketId: req.params.id,
                    status: req.body.status,
                    priority: req.body.priority,
                    noteChanged: true
                })
            ]
        )
        await client.query("COMMIT")
        res.json({ ticket: changed.rows[0] })
    } catch {
        if (client) await client.query("ROLLBACK").catch(() => {})
        res.status(503).json({ error: "Не удалось сохранить заявку" })
    } finally {
        client?.release()
    }
})
export default router
