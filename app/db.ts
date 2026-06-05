/**
 * Data access layer.
 *
 * better-sqlite3 connection + WAL/foreign-keys pragmas, the data-table `Database`
 * instance, the full DDL (the schema from docs/REQUIREMENTS.md §2), a
 * PRAGMA user_version migration runner, and typed table() metadata + row types.
 *
 * The table() defs do NOT create DDL — `migrate()` (raw SQL, run at import) is the
 * source of truth for the real schema. The table() defs mirror the live columns so
 * the data-table query API (db.create/find/findMany/update/delete) is typed; raw
 * UPSERTs / joins / explicit-NULL writes use the `sql` escape hatch
 * (`db.exec(sql\`...\`)` returns `{ rows }`).
 */
import BetterSqlite3 from "better-sqlite3";
import { createDatabase, sql, column as c, table } from "remix/data-table";
import { createSqliteDatabaseAdapter } from "remix/data-table/sqlite";
import type { TableRow } from "remix/data-table";

import { DB_PATH } from "./config.ts";

// ============ CONNECTION ============

export const sqlite = new BetterSqlite3(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const adapter = createSqliteDatabaseAdapter(sqlite);
export const db = createDatabase(adapter);

export function closeDb(): void {
  sqlite.close();
}

// ============ DDL + MIGRATIONS (raw SQL, runs at import) ============

/**
 * Versioned migration runner keyed off PRAGMA user_version. Each step bumps the
 * version so a step runs exactly once across restarts. Add new steps by appending
 * to `migrations` and incrementing — never edit a shipped step.
 */
const migrations: Array<(s: BetterSqlite3.Database) => void> = [
  // v1 → full baseline schema (REQUIREMENTS.md §2).
  (s) => {
    s.exec(`
      -- google_id is nullable: v1 PoC uses email+password (password_hash), but the
      -- column is kept so Google SSO can be swapped back in without a migration.
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        google_id     TEXT UNIQUE,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        name          TEXT NOT NULL,
        avatar_url    TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE households (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT NOT NULL,
        week_start_day INTEGER NOT NULL DEFAULT 0,   -- 0=Sunday .. 6=Saturday
        takeout_target INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE memberships (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        role         TEXT NOT NULL CHECK(role IN ('adult','kid')),
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, household_id)
      );

      CREATE TABLE invites (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        token        TEXT NOT NULL UNIQUE,
        role         TEXT NOT NULL CHECK(role IN ('adult','kid')),
        created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expires_at   TEXT NOT NULL,
        used_at      TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE ideas (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        note         TEXT,
        recipe_url   TEXT,
        tags         TEXT,                            -- JSON array of strings
        created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at   TEXT                             -- soft delete (R3.5)
      );

      CREATE TABLE slots (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id      INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        date              TEXT NOT NULL,              -- YYYY-MM-DD
        slot_type         TEXT NOT NULL DEFAULT 'dinner',
        idea_id           INTEGER REFERENCES ideas(id) ON DELETE SET NULL,
        text              TEXT,
        kind              TEXT NOT NULL DEFAULT 'home'
                            CHECK(kind IN ('home','takeout','leftovers','out')),
        takeout_unplanned INTEGER NOT NULL DEFAULT 0, -- 0/1 bool
        updated_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(household_id, date, slot_type)
      );

      CREATE TABLE grocery_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        text         TEXT NOT NULL,
        checked_at   TEXT,
        created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE snack_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        week_start_date TEXT NOT NULL,                -- YYYY-MM-DD anchor
        text            TEXT NOT NULL,
        created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_memberships_user ON memberships(user_id);
      CREATE INDEX idx_memberships_household ON memberships(household_id);
      CREATE INDEX idx_invites_token ON invites(token);
      CREATE INDEX idx_ideas_household ON ideas(household_id);
      CREATE INDEX idx_slots_household_date ON slots(household_id, date);
      CREATE INDEX idx_slots_idea ON slots(idea_id);
      CREATE INDEX idx_grocery_household ON grocery_items(household_id);
      CREATE INDEX idx_snacks_household_week ON snack_items(household_id, week_start_date);
    `);
  },

  // v2 → per-user color theme preference. 'system' follows the OS
  // (light-dark() tokens); 'light'/'dark' force it via data-theme on <html>.
  (s) => {
    s.exec(`
      ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'system'
        CHECK(theme IN ('system','light','dark'));
    `);
  },
];

function migrate(): void {
  const current = (sqlite.pragma("user_version", { simple: true }) as number) ?? 0;
  for (let v = current; v < migrations.length; v++) {
    const step = migrations[v];
    sqlite.transaction(() => {
      step(sqlite);
      sqlite.pragma(`user_version = ${v + 1}`);
    })();
  }
}

migrate();

// ============ TABLE METADATA + ROW TYPES ============

export const users = table({
  name: "users",
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    google_id: c.text().unique(),
    email: c.text().notNull().unique(),
    password_hash: c.text(),
    name: c.text().notNull(),
    avatar_url: c.text(),
    theme: c.enum(["system", "light", "dark"]).notNull().default("system"),
    created_at: c.text().notNull(),
  },
});

export const households = table({
  name: "households",
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    name: c.text().notNull(),
    week_start_day: c.integer().notNull().default(0),
    takeout_target: c.integer().notNull().default(0),
    created_at: c.text().notNull(),
  },
});

export const memberships = table({
  name: "memberships",
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    user_id: c.integer().notNull().references("users", "id").onDelete("cascade"),
    household_id: c.integer().notNull().references("households", "id").onDelete("cascade"),
    role: c.enum(["adult", "kid"]).notNull(),
    created_at: c.text().notNull(),
  },
});

export const invites = table({
  name: "invites",
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    household_id: c.integer().notNull().references("households", "id").onDelete("cascade"),
    token: c.text().notNull().unique(),
    role: c.enum(["adult", "kid"]).notNull(),
    created_by: c.integer().references("users", "id"),
    expires_at: c.text().notNull(),
    used_at: c.text(),
    created_at: c.text().notNull(),
  },
});

export const ideas = table({
  name: "ideas",
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    household_id: c.integer().notNull().references("households", "id").onDelete("cascade"),
    name: c.text().notNull(),
    note: c.text(),
    recipe_url: c.text(),
    tags: c.text(), // JSON array
    created_by: c.integer().references("users", "id"),
    created_at: c.text().notNull(),
    updated_at: c.text().notNull(),
    deleted_at: c.text(),
  },
});

export const slots = table({
  name: "slots",
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    household_id: c.integer().notNull().references("households", "id").onDelete("cascade"),
    date: c.text().notNull(),
    slot_type: c.text().notNull().default("dinner"),
    idea_id: c.integer().references("ideas", "id"),
    text: c.text(),
    kind: c.enum(["home", "takeout", "leftovers", "out"]).notNull().default("home"),
    takeout_unplanned: c.integer().notNull().default(0), // 0/1 bool
    updated_by: c.integer().references("users", "id"),
    updated_at: c.text().notNull(),
  },
});

export const groceryItems = table({
  name: "grocery_items",
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    household_id: c.integer().notNull().references("households", "id").onDelete("cascade"),
    text: c.text().notNull(),
    checked_at: c.text(),
    created_by: c.integer().references("users", "id"),
    created_at: c.text().notNull(),
  },
});

export const snackItems = table({
  name: "snack_items",
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    household_id: c.integer().notNull().references("households", "id").onDelete("cascade"),
    week_start_date: c.text().notNull(),
    text: c.text().notNull(),
    created_by: c.integer().references("users", "id"),
    created_at: c.text().notNull(),
  },
});

export type User = TableRow<typeof users>;
export type Household = TableRow<typeof households>;
export type Membership = TableRow<typeof memberships>;
export type Invite = TableRow<typeof invites>;
export type Idea = TableRow<typeof ideas>;
export type Slot = TableRow<typeof slots>;
export type GroceryItem = TableRow<typeof groceryItems>;
export type SnackItem = TableRow<typeof snackItems>;
export type Role = Membership["role"];
export type Theme = User["theme"];
export type SlotKind = Slot["kind"];

// ============ USER OPERATIONS ============

export function nowIso(): string {
  return new Date().toISOString();
}

export async function getUserById(id: number): Promise<User | undefined> {
  return db.find(users, id) as Promise<User | undefined>;
}

/** Case-insensitive email lookup (emails are stored lower-cased on insert). */
export async function getUserByEmail(email: string): Promise<User | undefined> {
  const result = await db.exec(sql`SELECT * FROM users WHERE email = ${email.toLowerCase()} LIMIT 1`);
  return (result.rows ?? [])[0] as User | undefined;
}

export async function createUser(input: {
  email: string;
  name: string;
  password_hash: string | null;
  google_id?: string | null;
  avatar_url?: string | null;
}): Promise<User> {
  return (await db.create(
    users,
    {
      email: input.email.toLowerCase(),
      name: input.name,
      password_hash: input.password_hash ?? undefined,
      google_id: input.google_id ?? undefined,
      avatar_url: input.avatar_url ?? undefined,
      created_at: nowIso(),
    },
    { returnRow: true }
  )) as User;
}

// ============ HOUSEHOLD / MEMBERSHIP OPERATIONS ============

export async function createHousehold(input: {
  name: string;
  week_start_day: number;
  takeout_target: number;
}): Promise<Household> {
  return (await db.create(
    households,
    {
      name: input.name,
      week_start_day: input.week_start_day,
      takeout_target: input.takeout_target,
      created_at: nowIso(),
    },
    { returnRow: true }
  )) as Household;
}

export async function getHousehold(id: number): Promise<Household | undefined> {
  return db.find(households, id) as Promise<Household | undefined>;
}

export async function updateHousehold(
  id: number,
  patch: { name?: string; week_start_day?: number; takeout_target?: number }
): Promise<void> {
  await db.update(households, id, patch);
}

export async function addMembership(input: {
  user_id: number;
  household_id: number;
  role: Role;
}): Promise<Membership> {
  return (await db.create(
    memberships,
    { user_id: input.user_id, household_id: input.household_id, role: input.role, created_at: nowIso() },
    { returnRow: true }
  )) as Membership;
}

/** The user's single v1 membership (most recent if somehow more than one). */
export async function getMembershipForUser(userId: number): Promise<Membership | undefined> {
  return db.findOne(memberships, {
    where: { user_id: userId },
    orderBy: ["id", "desc"],
  }) as Promise<Membership | undefined>;
}

export async function getMembership(userId: number, householdId: number): Promise<Membership | undefined> {
  return db.findOne(memberships, {
    where: { user_id: userId, household_id: householdId },
  }) as Promise<Membership | undefined>;
}

/** All members of a household joined to user details (Settings member list). */
export async function getHouseholdMembers(
  householdId: number
): Promise<Array<{ membership: Membership; user: User }>> {
  const result = await db.exec(sql`
    SELECT m.id AS m_id, m.role AS m_role, m.created_at AS m_created_at,
           m.user_id AS m_user_id, m.household_id AS m_household_id,
           u.*
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.household_id = ${householdId}
    ORDER BY m.created_at ASC
  `);
  return (result.rows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const membership: Membership = {
      id: Number(row.m_id),
      user_id: Number(row.m_user_id),
      household_id: Number(row.m_household_id),
      role: row.m_role as Role,
      created_at: String(row.m_created_at),
    };
    const user: User = {
      id: Number(row.id),
      google_id: (row.google_id as string | null) ?? null,
      email: String(row.email),
      password_hash: (row.password_hash as string | null) ?? null,
      name: String(row.name),
      avatar_url: (row.avatar_url as string | null) ?? null,
      theme: (row.theme as Theme) ?? "system",
      created_at: String(row.created_at),
    } as User;
    return { membership, user };
  });
}

// ============ INVITE OPERATIONS ============

export async function createInvite(input: {
  household_id: number;
  role: Role;
  created_by: number;
  token: string;
  expires_at: string;
}): Promise<Invite> {
  return (await db.create(
    invites,
    {
      household_id: input.household_id,
      role: input.role,
      created_by: input.created_by,
      token: input.token,
      expires_at: input.expires_at,
      created_at: nowIso(),
    },
    { returnRow: true }
  )) as Invite;
}

export async function getInviteByToken(token: string): Promise<Invite | undefined> {
  return db.findOne(invites, { where: { token } }) as Promise<Invite | undefined>;
}

/** Mark an invite consumed. Raw SQL so used_at is written explicitly. */
export async function markInviteUsed(id: number): Promise<void> {
  await db.exec(sql`UPDATE invites SET used_at = ${nowIso()} WHERE id = ${id}`);
}
