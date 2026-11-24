import type { PoolClient } from "pg"

export type RuntimeRoleNames = Record<"gateway" | "auth" | "chat" | "room", string>

export function configuredRuntimeRoleNames(): RuntimeRoleNames {
    return {
        gateway: process.env.PLAYTIME_GATEWAY_PG_USER || "",
        auth: process.env.PLAYTIME_AUTH_PG_USER || "",
        chat: process.env.PLAYTIME_CHAT_PG_USER || "",
        room: process.env.PLAYTIME_ROOM_PG_USER || ""
    }
}

type Grant = {
    privilege: string
    objects: readonly string[]
    sequence?: true
}

const sessionRead: Grant[] = [
    { privilege: "SELECT (id, user_id, revoked_at, expires_at, session_version)", objects: ["auth_sessions"] }
]

const grants: Record<keyof RuntimeRoleNames, Grant[]> = {
    auth: [
        { privilege: "SELECT, DELETE", objects: ["users"] },
        {
            privilege: "INSERT (username, email, password_hash, email_verified_at, is_guest)",
            objects: ["users"]
        },
        {
            privilege:
                "UPDATE (username, email, password_hash, email_verified_at, is_guest, guest_registration_pending, auth_version, guest_archived_at, guest_original_username, is_blocked, blocked_at, blocked_reason)",
            objects: ["users"]
        },
        {
            privilege: "SELECT, INSERT, UPDATE, DELETE",
            objects: ["auth_sessions", "password_recovery", "email_verification_codes", "session_revocation_codes"]
        },
        {
            privilege: "SELECT, INSERT, DELETE",
            objects: ["revoked_access_tokens", "auth_refresh_receipts", "auth_guest_receipts"]
        },
        { privilege: "UPDATE (expires_at)", objects: ["revoked_access_tokens"] },
        { privilege: "SELECT, INSERT, UPDATE", objects: ["username_reclaims"] },
        { privilege: "INSERT", objects: ["admin_audit_log"] },
        { privilege: "SELECT, INSERT", objects: ["auth_migration_state"] },
        { privilege: "SELECT (id, user_id, friend_id)", objects: ["friendships"] },
        { privilege: "USAGE", objects: ["users_id_seq", "admin_audit_log_id_seq"], sequence: true }
    ],
    chat: [
        ...sessionRead,
        {
            privilege:
                "SELECT (id, username, email, created_at, is_guest, guest_registration_pending, guest_archived_at, guest_original_username, auth_version, is_blocked, profile_status, profile_bio, profile_avatar, profile_banner, profile_avatar_effect, profile_banner_effect, profile_banner_sticker, dm_public_key)",
            objects: ["users"]
        },
        {
            privilege:
                "UPDATE (profile_status, profile_bio, profile_avatar, profile_banner, profile_avatar_effect, profile_banner_effect, profile_banner_sticker, dm_public_key)",
            objects: ["users"]
        },
        {
            privilege: "SELECT",
            objects: ["username_reclaims", "billing_entitlements", "user_subscriptions", "room_key_history", "media_quota_usage"]
        },
        {
            privilege: "SELECT, INSERT, UPDATE, DELETE",
            objects: [
                "friendships",
                "rooms",
                "room_members",
                "messages",
                "media_objects",
                "message_reactions",
                "room_e2ee_wraps",
                "dm_wallpapers"
            ]
        },
        {
            privilege: "SELECT, INSERT, DELETE",
            objects: ["user_blocks", "voice_staging", "attachment_staging", "message_send_receipts"]
        },
        { privilege: "SELECT, INSERT, UPDATE", objects: ["user_reports", "room_read_state", "dm_pinned_messages"] },
        { privilege: "SELECT, INSERT", objects: ["dm_thread_operations"] },
        { privilege: "SELECT (id, user_id, session_id, enabled, muted_chats)", objects: ["push_devices"] },
        { privilege: "SELECT (device_id, event_key), INSERT", objects: ["push_outbox"] },
        { privilege: "INSERT", objects: ["admin_audit_log"] },
        {
            privilege: "USAGE",
            objects: [
                "friendships_id_seq",
                "rooms_id_seq",
                "messages_id_seq",
                "user_reports_id_seq",
                "dm_thread_operations_id_seq",
                "push_outbox_id_seq",
                "admin_audit_log_id_seq"
            ],
            sequence: true
        }
    ],
    gateway: [
        ...sessionRead,
        {
            privilege:
                "SELECT (id, username, email, created_at, is_admin, is_guest, guest_registration_pending, guest_archived_at, email_verified_at, auth_version, is_blocked, blocked_at, blocked_reason, profile_avatar_effect, profile_banner_effect, profile_banner_sticker, profile_banner)",
            objects: ["users"]
        },
        {
            privilege: "UPDATE (profile_avatar_effect, profile_banner_effect, profile_banner_sticker, profile_banner)",
            objects: ["users"]
        },
        {
            privilege: "SELECT",
            objects: [
                "schema_migrations",
                "site_visit_settings",
                "user_blocks",
                "friendships",
                "room_members",
                "room_e2ee_wraps"
            ]
        },
        { privilege: "SELECT, INSERT", objects: ["admin_audit_log", "billing_entitlements"] },
        {
            privilege: "SELECT, INSERT, UPDATE",
            objects: ["billing_orders", "feedback_tickets", "user_subscriptions", "site_visit_days"]
        },
        {
            privilege: "SELECT, INSERT, UPDATE, DELETE",
            objects: ["app_releases", "push_devices", "site_visit_sessions"]
        },
        { privilege: "SELECT, UPDATE, DELETE", objects: ["push_outbox"] },
        {
            privilege: "USAGE",
            objects: ["app_releases_id_seq", "feedback_tickets_id_seq", "admin_audit_log_id_seq"],
            sequence: true
        }
    ],
    room: []
}

function identifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`
}

const knownGrants = Object.values(grants).flat()
const tables = [...new Set(knownGrants.filter(({ sequence }) => !sequence).flatMap(({ objects }) => objects))]
const sequences = [...new Set(knownGrants.filter(({ sequence }) => sequence).flatMap(({ objects }) => objects))]

function qualifiedObjects(objects: readonly string[]): string {
    return objects.map((name) => `public.${identifier(name)}`).join(", ")
}

async function standaloneRoleIds(client: PoolClient, names: string[]): Promise<string[]> {
    const { rows } = await client.query<{ id: string }>(
        `SELECT r.oid::text AS id FROM pg_catalog.pg_roles r
         WHERE r.rolname = ANY($1::text[]) AND r.rolname <> CURRENT_USER
           AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
           AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname = current_database() AND d.datdba = r.oid
           )
           AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname = 'public' AND n.nspowner = r.oid
           )`,
        [names]
    )
    if (rows.length !== names.length)
        throw new Error("Runtime roles must exist and have no administrative attributes or database/schema ownership")

    const ids = rows.map(({ id }) => id)
    const memberships = await client.query(
        `SELECT 1 FROM pg_catalog.pg_auth_members
         WHERE member = ANY($1::oid[]) OR roleid = ANY($1::oid[])
         LIMIT 1`,
        [ids]
    )
    if (memberships.rows.length) throw new Error("Runtime roles must have no role memberships in either direction")
    return ids
}

async function validateRuntimeRelations(client: PoolClient, roleIds: string[]) {
    const {
        rows: [schema]
    } = await client.query<{ can_grant_usage: boolean }>(
        "SELECT pg_catalog.has_schema_privilege('public', 'USAGE WITH GRANT OPTION') AS can_grant_usage"
    )
    if (!schema.can_grant_usage) throw new Error("The grantor must be able to grant USAGE on schema public")

    const { rows: relations } = await client.query<{ name: string; owner: string; columns: string[] }>(
        `SELECT c.relname AS name, c.relowner::text AS owner, ARRAY(
             SELECT a.attname::text FROM pg_catalog.pg_attribute a
             WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
             ORDER BY a.attnum
         ) AS columns
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND pg_catalog.pg_has_role(c.relowner, 'USAGE')
            AND ((c.relkind IN ('r', 'p') AND c.relname = ANY($1::text[]))
                OR (c.relkind = 'S' AND c.relname = ANY($2::text[])))`,
        [tables, sequences]
    )
    if (relations.length !== tables.length + sequences.length)
        throw new Error("Run migrations and reconcile grants as the owner of the PlayTime tables and sequences")
    if (relations.some(({ owner }) => roleIds.includes(owner)))
        throw new Error("Runtime roles must not own PlayTime tables or sequences")

    return relations
}

async function resetRuntimePrivileges(
    client: PoolClient,
    names: string[],
    relations: { name: string; columns: string[] }[]
) {
    const roles = names.map(identifier).join(", ")
    await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${roles} RESTRICT`)
    await client.query(`REVOKE ALL PRIVILEGES ON TABLE ${qualifiedObjects(tables)} FROM ${roles} RESTRICT`)
    await client.query(`REVOKE ALL PRIVILEGES ON SEQUENCE ${qualifiedObjects(sequences)} FROM ${roles} RESTRICT`)
    for (const { name, columns } of relations) {
        if (!tables.includes(name) || !columns.length) continue
        await client.query(
            `REVOKE ALL PRIVILEGES (${columns.map(identifier).join(", ")}) ON TABLE ${qualifiedObjects([name])} FROM ${roles} RESTRICT`
        )
    }
}

async function checkRuntimeGrants(client: PoolClient, roleIds: string[], reconcile: boolean): Promise<void> {
    const surviving = await client.query(
        `WITH known_relations AS (
             SELECT c.oid, c.relacl, c.relowner FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
         ), grants AS (
             SELECT acl.grantee, acl.grantor, acl.is_grantable, c.relowner FROM known_relations c
             CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
             UNION ALL
             SELECT acl.grantee, acl.grantor, acl.is_grantable, c.relowner FROM known_relations c
             JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
             CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl
             WHERE a.attnum > 0 AND NOT a.attisdropped
         )
         SELECT 1 FROM grants WHERE grantee = 0
             OR (grantee = ANY($2::oid[]) AND ($3::boolean OR grantor <> relowner OR is_grantable))
         UNION ALL
         SELECT 1 FROM unnest($2::oid[]) AS roles(id)
         WHERE pg_catalog.has_schema_privilege(id, 'public', 'CREATE')
            OR pg_catalog.has_schema_privilege(id, 'public', 'USAGE WITH GRANT OPTION')
         LIMIT 1`,
        [[...tables, ...sequences], roleIds, reconcile]
    )
    if (surviving.rows.length)
        throw new Error("Existing public or delegated grants prevent exclusive runtime privileges on PlayTime objects")
}

export async function applyRuntimePrivilegesInTransaction(
    client: PoolClient,
    roleNames: RuntimeRoleNames,
    mode: "expand" | "reconcile"
): Promise<void> {
    const assignments = [
        [roleNames.auth, grants.auth],
        [roleNames.chat, grants.chat],
        [roleNames.gateway, grants.gateway],
        [roleNames.room, grants.room]
    ] as const
    const names = assignments.map(([name]) => name)
    if (names.some((name) => !name || name === "public" || name.startsWith("pg_")) || new Set(names).size !== 4)
        throw new Error("Create distinct PostgreSQL runtime roles before granting privileges")

    const roleIds = await standaloneRoleIds(client, names)
    const relations = await validateRuntimeRelations(client, roleIds)
    if (mode === "reconcile") await resetRuntimePrivileges(client, names, relations)
    await checkRuntimeGrants(client, roleIds, mode === "reconcile")

    for (const [role, privileges] of assignments) {
        const name = identifier(role)
        await client.query(`GRANT USAGE ON SCHEMA public TO ${name}`)
        for (const { privilege, objects, sequence } of privileges) {
            await client.query(
                `GRANT ${privilege} ON ${sequence ? "SEQUENCE" : "TABLE"} ${qualifiedObjects(objects)} TO ${name}`
            )
        }
    }
}

export async function grantLocalRuntimePrivileges(client: PoolClient, roleNames: RuntimeRoleNames): Promise<void> {
    await client.query("BEGIN")
    try {
        await applyRuntimePrivilegesInTransaction(client, roleNames, "reconcile")
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined)
        throw error
    }
}
