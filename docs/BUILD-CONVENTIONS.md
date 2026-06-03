# eat — Build Conventions (for feature agents)

This skeleton wires auth, onboarding, the DB, the layout, and four empty feature
modules. Your job is to fill in ONE feature module. Read this, then read your
module's file header — it lists the exact requirements (R-numbers) you own.

Stack: Remix 3 (3.0.0-beta.3), SSR (no hydration), better-sqlite3, Tailwind v4 +
DaisyUI (theme `nord`). TS runs under `tsx` at runtime — no build step except CSS.

---

## 0. The one rule

**Do not touch `server.ts` or `app/router.ts`.** All routing for your feature is
delegated into your module via `registerRoutes(router)`, which the router already
calls at boot. You only ever edit your own `app/routes/<feature>.tsx` (plus views
under `app/views/` and shared DB helpers in `app/db.ts` if you must add a query).

---

## 1. File ownership map

| Path | Owner | Notes |
|---|---|---|
| `server.ts` | skeleton | bootstrap only — do not edit |
| `app/router.ts` | skeleton | middleware stack + maps every controller — do not edit |
| `app/routes.ts` | shared | URL contract. Add a leaf under YOUR namespace only |
| `app/config.ts` | skeleton | env (SESSION_SECRET, DB_PATH, PORT, INVITE_TTL) |
| `app/db.ts` | shared | schema + table defs + query helpers. Add helpers; don't change schema casually (it's a versioned migration — append a new step, never edit a shipped one) |
| `app/auth.ts` | skeleton | session cookie + guards. Use its exports; don't reimplement |
| `app/crypto.ts` | skeleton | scrypt + safeEqual + randomToken |
| `app/render.tsx` | skeleton | `render(<Jsx/>, init?)` |
| `app/views/layout.tsx` | shared | `Layout` (tab nav) + `AuthShell`. Use, don't fork |
| `app/views/placeholder.tsx` | scaffold | delete once your real page exists |
| `app/views/auth-pages.tsx` | skeleton | signup/login/join/onboarding pages |
| `app/controllers/auth-controller.tsx` | skeleton | signup/login/logout/join/household — do not edit |
| `app/routes/week.tsx` | **week agent** | R2.* |
| `app/routes/ideas.tsx` | **ideas agent** | R3.* |
| `app/routes/grocery.tsx` | **grocery agent** | R4.* |
| `app/routes/settings.tsx` | **settings agent** | R5.* (invite-CREATE already done) |
| `public/static/app.js` | shared | the ONLY client JS (renderer escapes inline `<script>`) |
| `styles/app.css` | shared | Tailwind `@source` globs — already cover `app/**/*.tsx` |

---

## 2. Adding a route in your module

1. Add the leaf to YOUR namespace in `app/routes.ts`:
   ```ts
   week: route("week", {
     index: get("/"),
     setSlot: post("set-slot"),
     myNewThing: post("my-new-thing"),   // <-- add here
   }),
   ```
2. Add the matching action key in your module's controller (same key name).
3. That's it — `registerRoutes(router)` already maps your whole namespace.

**Never hardcode URL strings.** Use `routes.week.setSlot.href()` /
`routes.ideas.index.href()`. Params: `routes.join.action.href({ token })`.

GET pages render HTML; POST mutations do the work then **303-redirect** back to the
list page (POST-redirect-GET — works without JS). Every POST action MUST keep
`requireSameOrigin()` in its middleware (CSRF).

---

## 3. Auth helpers (`app/auth.ts`) — signatures

```ts
// Context key set by global middleware — read it in every action:
const CurrentUserId: ContextKey<number | null>;   // get(CurrentUserId)

// GUARDS — call at the top of an action. Return a GuardResult; if !ok, return its response.
type GuardResult<T> = { ok: true; value: T } | { ok: false; response: Response };

interface Session { user: User; membership: Membership; household: Household; role: "adult" | "kid"; }

requireUser(userId: number | null): Promise<GuardResult<Session>>;
//   no session -> 303 /login ;  no household -> 303 /household/new ;  else ok+Session
requireAdult(userId: number | null): Promise<GuardResult<Session>>;
//   requireUser + role must be "adult" else 403  (server-side R1.5 enforcement)

requireSameOrigin(): Middleware;        // CSRF guard — put in every POST action's middleware

// cookie builders (used by the auth controller; you won't normally need these):
loginCookie(userId): string;  logoutCookie(): string;
```

**Canonical action shape** (copy this):
```tsx
async index({ get }) {
  const g = await requireUser(get(CurrentUserId));   // or requireAdult
  if (!g.ok) return g.response;
  const { user, household, membership, role } = g.value;
  // ... load data scoped to household.id ...
  return render(<MyPage ... />);
}

myMutation: {
  middleware: [requireSameOrigin()],
  async handler({ get }) {
    const g = await requireAdult(get(CurrentUserId));
    if (!g.ok) return g.response;
    const parsed = s.parseSafe(myForm, get(FormData));   // FormData = JS global, NOT an import
    if (!parsed.success) return redirect(routes.X.index.href(), 303);
    // ... mutate, scoped to g.value.household.id ...
    return redirect(routes.X.index.href(), 303);
  },
}
```

> **Gotcha:** `get(FormData)` reads the parsed form body. `FormData` is the global
> JS constructor used directly as the context key — **do not import it**.

**Tenancy:** every query MUST be scoped to `g.value.household.id`. Never trust a
household id from the form/URL — derive it from the session.

---

## 4. DB helpers (`app/db.ts`) — signatures

`db` is the data-table instance. Table defs: `users`, `households`, `memberships`,
`invites`, `ideas`, `slots`, `groceryItems`, `snackItems`. Row types: `User`,
`Household`, `Membership`, `Invite`, `Idea`, `Slot`, `GroceryItem`, `SnackItem`,
`Role`, `SlotKind`.

```ts
// data-table query API (typed CRUD):
await db.create(ideas, { household_id, name, created_at: nowIso(), updated_at: nowIso() }, { returnRow: true });
await db.find(ideas, id);                                  // by PK
await db.findOne(slots, { where: { household_id, date, slot_type: "dinner" } });
await db.findMany(groceryItems, { where: { household_id }, orderBy: ["created_at", "asc"] });
await db.update(households, id, { takeout_target: 3 });
await db.delete(groceryItems, id);
await db.count(ideas);

// raw escape hatch — UPSERTs, joins, COLLATE, and writing explicit NULL
// (db.update can't write null; TableRow types omit null):
import { sql } from "remix/data-table";
const { rows } = await db.exec(sql`SELECT ... WHERE household_id = ${hid}`);
await db.exec(sql`UPDATE slots SET idea_id = ${null}, text = ${text} WHERE id = ${id}`);

// helpers already provided:
nowIso(): string;
getUserById / getUserByEmail / createUser;
createHousehold / getHousehold / updateHousehold;
addMembership / getMembershipForUser / getMembership / getHouseholdMembers;
createInvite / getInviteByToken / markInviteUsed;
```

Booleans are stored as INTEGER 0/1 (`slots.takeout_unplanned`,
`grocery_items.checked_at` is a nullable timestamp not a bool). `ideas.tags` is a
JSON string — `JSON.stringify` on write, `JSON.parse` on read.

Soft delete (ideas, R3.5): set `deleted_at = nowIso()` instead of `db.delete`; add
`AND deleted_at IS NULL` to your list queries. Slots reference ideas with
`ON DELETE SET NULL`, so a hard-deleted idea won't break past slots — but prefer
soft delete so "last planned" history survives.

Week math: a week is derived from `households.week_start_day` (0=Sun..6=Sat) + a
date; there is no week entity. Compute the week's start date in your module.

---

## 5. Views / layout

Every `.tsx` view starts with the two pragma lines:
```tsx
/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
```
Component shape: `function Comp(handle: Handle<Props>) { return () => <jsx/>; }`
(props read off `handle.props` inside the returned closure). Use `class=` not
`className=`. Render an empty branch as `""`.

Wrap feature pages in `Layout`:
```tsx
import { Layout } from "../views/layout.tsx";
return () => (
  <Layout title="Week" active="week" showSettings={role === "adult"}>
    {content}
  </Layout>
);
```
`active` ∈ `"week" | "ideas" | "grocery" | "settings"` highlights the tab.
`showSettings={role === "adult"}` hides the Settings tab from kids.

Pre-household pages use `AuthShell` (no nav) — skeleton owns those; you won't need it.

Client JS: add delegated listeners to `public/static/app.js` only. For
confirm-on-delete, put `data-confirm="Delete this?"` on the `<form>`/`<button>` —
the shared handler already wires it.

---

## 6. Run / verify

```bash
npm install
npm run typecheck            # MUST pass
SESSION_SECRET=dev npm run dev   # builds CSS, serves on PORT (default 8000)
curl localhost:8000/health  # -> OK
```

POSTs need an `Origin` header matching the host (CSRF guard). In a browser this is
automatic; with curl pass `-H "Origin:http://localhost:8000"` and a cookie jar.

---

## 7. Deviations from the conventions brief (already baked in)

- **Auth: email+password, not Google SSO.** No OAuth creds for the PoC. The user
  model stays SSO-ready (`users.google_id` nullable unique; `createUser` accepts
  `google_id`). To restore SSO later: add an OAuth controller that sets `google_id`
  and reuse the same `loginCookie`/session machinery. Marked in `app/auth.ts`.
- **Feature route modules are `.tsx`, not `.ts`.** They contain JSX, and esbuild
  only parses JSX in `.tsx`. (The task brief said `.ts`; JSX forces `.tsx`.)
- **Session cookie** is `eat_session = <userId>.<hmac>` (HMAC-SHA256 over the user
  id, keyed by `SESSION_SECRET`) — a signed identity cookie, vs tv-tracker's single
  shared-secret cookie, because eat has real per-user identity.
- **Migrations** use `PRAGMA user_version` versioned steps (append-only), not
  tv-tracker's `CREATE TABLE IF NOT EXISTS` + ad-hoc `ALTER`.
- **`registerRoutes(router: Router<AppContext>)`** is the module composition seam —
  the `<AppContext>` type arg is REQUIRED or `router.map` rejects the controller.
- Theme is `nord` (tv-tracker used `abyss`).
```
