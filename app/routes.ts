/**
 * Route contract — the single source of truth for every URL in the app.
 *
 * `href()` generation and controller wiring all derive from this map. Auth +
 * onboarding leaves are owned by server.ts; the four feature namespaces
 * (week / ideas / grocery / settings) are owned by the matching app/routes/*.ts
 * module, which maps its own controller via registerRoutes(router) WITHOUT
 * touching server.ts.
 *
 * Adding a route in a feature: add the leaf to that feature's namespace below,
 * then handle it in the feature module's controller. (Centralizing the map keeps
 * href() type-safe across modules.)
 */
import { get, post, route, form } from "remix/routes";

export const routes = route({
  root: get("/"), // GET / — bare-domain entry; redirects to the week view (or /login → onboarding via the guard chain)
  health: get("/health"), // GET /health

  // ── Auth + onboarding (owned by server.ts) ──
  signup: form("/signup"), // GET form + POST /signup
  login: form("/login"), // GET form + POST /login
  logout: post("/logout"), // POST /logout
  join: form("/join/:token"), // GET invite-join form + POST /join/:token
  householdNew: form("/household/new"), // GET create-household form + POST

  // ── Week / weekly plan (owned by app/routes/week.ts) ──
  week: route("week", {
    index: get("/"), // GET /week (current week; ?start=YYYY-MM-DD to navigate)
    setSlot: post("set-slot"), // POST /week/set-slot     (adult)
    clearSlot: post("clear-slot"), // POST /week/clear-slot   (adult)
    gotTakeout: post("got-takeout"), // POST /week/got-takeout  (adult, one-tap)
    setSnack: post("snack"), // POST /week/snack        (adult)
    deleteSnack: post("snack/delete"), // POST /week/snack/delete (adult)
  }),

  // ── Idea pool (owned by app/routes/ideas.ts) ──
  ideas: route("ideas", {
    index: get("/"), // GET /ideas (?q= &tag= filter)
    create: post("create"), // POST /ideas/create  (any member)
    update: post("update"), // POST /ideas/update  (own, or adult any)
    remove: post("delete"), // POST /ideas/delete  (own, or adult any) — soft delete
  }),

  // ── Grocery + snack copy (owned by app/routes/grocery.ts) ──
  grocery: route("grocery", {
    index: get("/"), // GET /grocery
    add: post("add"), // POST /grocery/add        (adult)
    toggle: post("toggle"), // POST /grocery/toggle     (adult) — check/uncheck
    remove: post("delete"), // POST /grocery/delete     (adult)
    clearChecked: post("clear-checked"), // POST /grocery/clear-checked (adult)
    addSnack: post("snack/add"), // POST /grocery/snack/add    (adult) — this week's snack list
    removeSnack: post("snack/delete"), // POST /grocery/snack/delete (adult)
    copySnack: post("copy-snack"), // POST /grocery/copy-snack (adult) — snack → grocery
  }),

  // ── Settings (owned by app/routes/settings.ts) ──
  settings: route("settings", {
    index: get("/"), // GET /settings (adult)
    update: post("update"), // POST /settings/update         (adult) — name/week start/target
    setTheme: post("theme"), // POST /settings/theme          (any member) — per-USER appearance pref
    createInvite: post("invite"), // POST /settings/invite         (adult)
    revokeInvite: post("invite/revoke"), // POST /settings/invite/revoke  (adult) — delete an invite
    removeMember: post("member/remove"), // POST /settings/member/remove  (adult)
    changeRole: post("member/role"), // POST /settings/member/role    (adult)
  }),
});

/**
 * Static asset namespace (GET /static/*path). Served entirely by staticFiles()
 * middleware — never reaches a controller, so it lives outside `routes`. Still
 * part of the URL contract for typed hrefs.
 */
export const staticRoute = route({ static: get("/static/*path") }).static;
export const staticUrl = (path: string): string => staticRoute.href({ path });
