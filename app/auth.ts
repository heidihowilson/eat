/**
 * Auth — email+password sessions for the v1 PoC.
 *
 * SPEC DEVIATION (intentional, see REQUIREMENTS.md R1.1): the product spec calls
 * for Google SSO only. No Google OAuth credentials are available for this PoC, so
 * we ship email+password auth instead. The user model stays SSO-ready — `google_id`
 * is a nullable unique column (app/db.ts), and `createUser` accepts a `google_id`.
 * To restore Google SSO later: add the OAuth controller, set google_id on the user
 * row, and keep this same session-cookie machinery (it is identity-agnostic — it
 * just carries a signed user id).
 *
 * Session model: a stateless signed cookie `eat_session = <userId>.<hmac>`. The
 * HMAC (keyed by SESSION_SECRET) over the user id is the proof — no server-side
 * session store. We hand-roll the cookie wire format (raw, not base64) following
 * the tv-tracker pattern so the value is predictable and debuggable.
 */
import { createContextKey, type Middleware } from "remix/router";
import { createHmac } from "node:crypto";
import { redirect } from "remix/response/redirect";

import { SESSION_SECRET, COOKIE_MAX_AGE } from "./config.ts";
import { safeEqual } from "./crypto.ts";
import {
  getUserById,
  getMembershipForUser,
  getHousehold,
  type User,
  type Membership,
  type Household,
  type Role,
} from "./db.ts";

if (!process.env.SESSION_SECRET) {
  console.log("[WARN] No SESSION_SECRET env var set — using an ephemeral secret. Sessions reset on restart.");
}

// ============ COOKIE WIRE FORMAT ============

export const SESSION_COOKIE_NAME = "eat_session";

function sign(userId: number): string {
  return createHmac("sha256", SESSION_SECRET).update(String(userId)).digest("hex");
}

/** Build the signed cookie value: `<userId>.<hmac>`. */
function sessionValue(userId: number): string {
  return `${userId}.${sign(userId)}`;
}

/** Parse + verify a session cookie value, returning the user id or null. */
function parseSessionValue(value: string | null): number | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;
  const idPart = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const userId = Number(idPart);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!safeEqual(sig, sign(userId))) return null;
  return userId;
}

interface CookieOpts {
  maxAge?: number;
}

function serializeSessionCookie(value: string, opts: CookieOpts = {}): string {
  let str = `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`;
  if (opts.maxAge !== undefined) str += `; Max-Age=${opts.maxAge}`;
  // Secure only in production: browsers exempt localhost from the Secure
  // requirement, but plain-http LAN access (e.g. http://192.168.x.x:8103
  // during a demo) would silently drop the cookie and loop back to /login.
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  str += `; Path=/; SameSite=Lax${secure}; HttpOnly`;
  return str;
}

function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === SESSION_COOKIE_NAME) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

/** Set-Cookie that logs `userId` in for 90 days. Use on login/signup. */
export function loginCookie(userId: number): string {
  return serializeSessionCookie(sessionValue(userId), { maxAge: COOKIE_MAX_AGE });
}

/** Set-Cookie that clears the session. Use on logout. */
export function logoutCookie(): string {
  return serializeSessionCookie("", { maxAge: 0 });
}

// ============ CONTEXT ============

/** The signed-in user id (or null), set by loadAuth() for every request. */
export const CurrentUserId = createContextKey<number | null>();

// ============ GLOBAL MIDDLEWARE ============

/**
 * Parses the session cookie into `CurrentUserId`. Never blocks — page/action
 * guards (requireUser / requireAdult) decide what to do when there is no user.
 */
export function loadAuth(): Middleware<{ key: typeof CurrentUserId; value: number | null }> {
  return (context, next) => {
    context.set(CurrentUserId, parseSessionValue(readSessionCookie(context.request)));
    return next();
  };
}

// ============ RESOLVERS / GUARDS (call from actions) ============

/** A signed-in user plus their current household + role, resolved together. */
export interface Session {
  user: User;
  membership: Membership;
  household: Household;
  role: Role;
}

/**
 * Resolve the full session (user + membership + household). Returns null when:
 *  - no/invalid session cookie, OR
 *  - the user has no household yet (onboarding not done).
 * Use `requireUser` / `requireAdult` instead of this when you want to redirect.
 */
export async function resolveSession(userId: number | null): Promise<Session | null> {
  if (userId === null) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  const membership = await getMembershipForUser(user.id);
  if (!membership) return null;
  const household = await getHousehold(membership.household_id);
  if (!household) return null;
  return { user, membership, household, role: membership.role };
}

/** The user row alone (may exist without a household, mid-onboarding). */
export async function resolveUser(userId: number | null): Promise<User | null> {
  if (userId === null) return null;
  return (await getUserById(userId)) ?? null;
}

/** Thrown-as-value redirect helper: a guard returns this Response to short-circuit. */
export type GuardResult<T> = { ok: true; value: T } | { ok: false; response: Response };

/**
 * Require a signed-in user. If not signed in → redirect to /login. If signed in
 * but no household → redirect to /household/new (onboarding).
 *
 * Usage in an action:
 *   const g = await requireUser(get(CurrentUserId));
 *   if (!g.ok) return g.response;
 *   const session = g.value;
 */
export async function requireUser(userId: number | null): Promise<GuardResult<Session>> {
  if (userId === null) return { ok: false, response: redirect("/login", 303) };
  const user = await getUserById(userId);
  if (!user) return { ok: false, response: redirect("/login", 303) };
  const membership = await getMembershipForUser(user.id);
  if (!membership) return { ok: false, response: redirect("/household/new", 303) };
  const household = await getHousehold(membership.household_id);
  if (!household) return { ok: false, response: redirect("/household/new", 303) };
  return { ok: true, value: { user, membership, household, role: membership.role } };
}

/**
 * Require an adult member (server-side enforcement of R1.5). Kids get a 403.
 *   const g = await requireAdult(get(CurrentUserId));
 *   if (!g.ok) return g.response;
 */
export async function requireAdult(userId: number | null): Promise<GuardResult<Session>> {
  const g = await requireUser(userId);
  if (!g.ok) return g;
  if (g.value.role !== "adult") {
    return { ok: false, response: new Response("Forbidden — adults only", { status: 403 }) };
  }
  return g;
}

// ============ CSRF DEFENSE ============

/**
 * Same-origin guard for state-changing POSTs. Compares `host` (hostname:port),
 * NOT full origin — TLS terminates at the Coolify/Traefik proxy, so the Node
 * server sees plain http while the browser sends https; comparing scheme would
 * false-reject every legit POST. Paired with the session cookie's SameSite=Lax,
 * host-comparison still blocks real cross-site/cross-port CSRF. Use as
 * controller/action middleware on every mutation route.
 */
export function requireSameOrigin(): Middleware {
  return (context, next) => {
    const forbid = () => new Response("Forbidden", { status: 403 });
    const source = context.request.headers.get("Origin") ?? context.request.headers.get("Referer");
    if (!source) return forbid();
    let sourceHost: string;
    try {
      sourceHost = new URL(source).host;
    } catch {
      return forbid();
    }
    if (sourceHost !== context.url.host) return forbid();
    return next();
  };
}
