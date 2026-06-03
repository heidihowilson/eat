/**
 * Runtime configuration derived from the environment.
 *
 * One module so middleware, the server bootstrap, and the data layer all read the
 * same values. SESSION_SECRET falls back to an ephemeral random value in dev so the
 * app still boots (a [WARN] is logged in auth.ts) — but every restart then
 * invalidates existing sessions, so set it in production.
 */
import { fileURLToPath } from "node:url";

/** HMAC secret for signing the session cookie. See app/auth.ts. */
export const SESSION_SECRET = process.env.SESSION_SECRET ?? crypto.randomUUID();

/** 90 days — rolling session-cookie expiry. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

/** Invite links expire after 7 days (R1.3). */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const PORT = parseInt(process.env.PORT ?? "8000");

/**
 * Directory `staticFiles()` serves from. It maps request pathname
 * `/static/app.css` to `<STATIC_ROOT>/static/app.css`, so assets live under
 * `public/static/*`.
 */
export const STATIC_ROOT = fileURLToPath(new URL("../public", import.meta.url));

/** Path to the SQLite database file (env-authoritative; defaults to repo root). */
export const DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL("../eat.db", import.meta.url));
