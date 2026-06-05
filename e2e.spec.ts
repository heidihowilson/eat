/**
 * Multi-user end-to-end suite for the "eat" household dinner planner.
 *
 * Drives the family demo from REQUIREMENTS §4 across THREE concurrent browser
 * contexts — adult A (desktop), kid K (iPhone 390x844), adult B (desktop) — to
 * exercise the real multi-user + role-enforcement behaviour, not just one user
 * clicking around. The webServer (see playwright.config.ts) runs the actual Remix
 * app on a fresh throwaway SQLite DB.
 *
 * Assertions are SEMANTIC (roles, text, form presence/absence, URLs, counts) so a
 * parallel visual-polish pass on the views can't break them. No sleeps: every wait
 * is on a URL, DOM state, or network response.
 *
 * The tests in this file run serially and share module-scoped state (the kid +
 * adult-B join URLs, today's date). They model one continuous family session, so
 * order matters and `test.describe.configure({ mode: "serial" })` is set.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

// ── Fixed identities for the run ──
const A = { name: "Avery Adult", email: "avery@example.com", password: "averypass123" };
const K = { name: "Kit Kid", email: "kit@example.com", password: "kitpass1234" };
const B = { name: "Blair Adult", email: "blair@example.com", password: "blairpass123" };

const iPhone = { width: 390, height: 844 };

// Shared across tests (serial mode).
let browser: Browser;
let ctxA: BrowserContext, ctxK: BrowserContext, ctxB: BrowserContext;
let pageA: Page, pageK: Page, pageB: Page;
let kidJoinUrl = "";
let adultJoinUrl = "";

// Today as the app computes it: UTC calendar date (week.tsx todayUtc()).
const todayIso = new Date().toISOString().slice(0, 10);
const POOL_IDEA = "Dumplings";

test.beforeAll(async ({ browser: b }) => {
  browser = b;
  ctxA = await browser.newContext(); // adult A — default desktop viewport
  ctxK = await browser.newContext({ viewport: iPhone, isMobile: false }); // kid — phone-sized
  ctxB = await browser.newContext(); // adult B — desktop
  pageA = await ctxA.newPage();
  pageK = await ctxK.newPage();
  pageB = await ctxB.newPage();

  // Destructive actions use a data-confirm window.confirm() guard (app.js).
  // Playwright auto-DISMISSES dialogs by default, which would cancel the submit;
  // accept them so destructive flows (clear-checked, etc.) actually run.
  for (const p of [pageA, pageK, pageB]) p.on("dialog", (d) => d.accept());
});

test.afterAll(async () => {
  await ctxA?.close();
  await ctxK?.close();
  await ctxB?.close();
});

// ── Helpers ──

async function signup(page: Page, u: { name: string; email: string; password: string }) {
  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill(u.name);
  await page.getByPlaceholder("Email").fill(u.email);
  await page.locator('input[name="password"]').fill(u.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

/** Open today's day card editor (the <details>) and plan it. Works on the week page. */
function dayCardByDate(page: Page, date: string) {
  // Each card carries the set-slot form with a hidden date input; scope to the card.
  return page
    .locator(".mk-card", { has: page.locator(`form input[name="date"][value="${date}"]`) })
    .first();
}

/** Plan a single day's slot via its editor form. */
async function planDay(
  page: Page,
  date: string,
  opts: { idea?: string; text?: string; kind?: string }
) {
  const card = dayCardByDate(page, date);
  // Open the <details> editor.
  const summary = card.locator("summary").first();
  if (await summary.isVisible()) await summary.click();
  const form = card.locator('form[action="/week/set-slot"]');
  if (opts.idea !== undefined) await form.locator('input[name="idea"]').fill(opts.idea);
  if (opts.text !== undefined) await form.locator('input[name="text"]').fill(opts.text);
  if (opts.kind !== undefined) await form.locator('select[name="kind"]').selectOption(opts.kind);
  await Promise.all([
    page.waitForURL("**/week"),
    form.getByRole("button", { name: "Save" }).click(),
  ]);
}

/** The dates Mon..Sat of the current Sunday-anchored week, plus today. */
function weekDates(): string[] {
  // Re-derive the Sunday-start week in UTC exactly like the server does.
  const now = new Date(`${todayIso}T00:00:00Z`);
  const dow = now.getUTCDay(); // 0=Sun
  const sunday = new Date(now.getTime() - dow * 86_400_000);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(sunday.getTime() + i * 86_400_000).toISOString().slice(0, 10)
  );
}

// ═══════════════════════════════════════════════════════════════════════════
test("1. Adult A signs up, creates household, lands on /week", async () => {
  await signup(pageA, A);
  // New signup with no household → onboarding.
  await pageA.waitForURL("**/household/new");

  await pageA.getByPlaceholder("e.g. The Gholsons").fill("eat");
  await pageA.locator('select[name="week_start_day"]').selectOption("0"); // Sunday
  await pageA.locator('input[name="takeout_target"]').fill("2");
  await Promise.all([
    pageA.waitForURL("**/week"),
    pageA.getByRole("button", { name: "Create household" }).click(),
  ]);

  // Landed on the week view, as an adult (Settings tab visible).
  await expect(pageA).toHaveURL(/\/week$/);
  await expect(pageA.getByRole("link", { name: "Settings" })).toBeVisible();
  // Counter starts at 0 / 2.
  await expect(pageA.getByText("0 / 2")).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════
test("2. A adds ideas and plans four kinds of slot", async () => {
  // ── Add ideas (R3.1): one rich one (tag + recipe URL), one plain. ──
  await pageA.goto("/ideas");
  const add = pageA.locator('form[action="/ideas/create"]');
  await add.locator('input[name="name"]').fill(POOL_IDEA);
  await add.locator('input[name="note"]').fill("Pork & chive");
  await add.locator('input[name="recipe_url"]').fill("https://example.com/dumplings");
  await add.locator('input[name="tags"]').fill("asian, freezer");
  await Promise.all([
    pageA.waitForURL("**/ideas"),
    add.getByRole("button", { name: "Add idea" }).click(),
  ]);
  await expect(pageA.getByRole("heading", { name: POOL_IDEA })).toBeVisible();
  // Recipe link + tag rendered.
  await expect(pageA.getByRole("link", { name: /Recipe/ })).toHaveAttribute(
    "href",
    "https://example.com/dumplings"
  );
  // The tag renders as a badge on the idea card (also appears in the filter
  // dropdown, so scope to the idea list item).
  const dumplingCard = pageA.locator("li.mk-card", {
    has: pageA.getByRole("heading", { name: POOL_IDEA }),
  });
  await expect(dumplingCard.getByText("asian", { exact: true })).toBeVisible();
  // Never planned yet.
  await expect(pageA.getByText("Never planned")).toBeVisible();

  // ── Plan the week (R2.2): from pool, freeform, takeout(kind), leftovers. ──
  const [sun, mon, tue, wed] = weekDates();
  await pageA.goto("/week");

  // Mon: from the idea pool → kind home.
  await planDay(pageA, mon, { idea: POOL_IDEA, kind: "home" });
  // Tue: freeform text → kind home.
  await planDay(pageA, tue, { text: "Sheet-pan chicken", kind: "home" });
  // Wed: freeform marked takeout (planned takeout — a *kind*, not the one-tap).
  await planDay(pageA, wed, { text: "Pizza night", kind: "takeout" });
  // Sun: freeform leftovers.
  await planDay(pageA, sun, { text: "Fridge cleanout", kind: "leftovers" });

  // Verify each landed.
  await pageA.goto("/week");
  await expect(pageA.getByText(POOL_IDEA)).toBeVisible();
  await expect(pageA.getByText("Sheet-pan chicken")).toBeVisible();
  await expect(pageA.getByText("Pizza night")).toBeVisible();
  await expect(pageA.getByText("Fridge cleanout")).toBeVisible();
  // The planned-takeout pizza pushes the counter to 1 planned.
  await expect(pageA.getByText("1 planned · 0 unplanned")).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════
test("3. A one-taps 'we got takeout' on today → counter shows used/target + unplanned", async () => {
  await pageA.goto("/week");
  // The one-tap button lives only on today's card.
  const todayCard = dayCardByDate(pageA, todayIso);
  const gotTakeout = todayCard.getByRole("button", { name: /We got takeout/ });
  await expect(gotTakeout).toBeVisible();

  await Promise.all([pageA.waitForURL("**/week"), gotTakeout.click()]);

  // Today's slot is now an unplanned takeout; counter reflects it.
  await expect(todayCard.getByText("unplanned")).toBeVisible();
  // Pizza (planned takeout) + today (unplanned) = 2 used, target 2.
  await expect(pageA.getByText("2 / 2")).toBeVisible();
  await expect(pageA.getByText("1 planned · 1 unplanned")).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════
test("4. A manages grocery + snack lists", async () => {
  await pageA.goto("/grocery");
  const groceryAdd = pageA.locator('form[action="/grocery/add"]');

  // Add two grocery items.
  await groceryAdd.locator('input[name="text"]').fill("Milk");
  await Promise.all([
    pageA.waitForURL("**/grocery"),
    groceryAdd.getByRole("button", { name: "Add" }).click(),
  ]);
  await pageA.locator('form[action="/grocery/add"] input[name="text"]').fill("Eggs");
  await Promise.all([
    pageA.waitForURL("**/grocery"),
    pageA.locator('form[action="/grocery/add"]').getByRole("button", { name: "Add" }).click(),
  ]);
  await expect(pageA.getByText("Milk", { exact: true })).toBeVisible();
  await expect(pageA.getByText("Eggs", { exact: true })).toBeVisible();

  // Check one off (the toggle is the row button labelled "Check off Milk").
  await Promise.all([
    pageA.waitForURL("**/grocery"),
    pageA.getByRole("button", { name: "Check off Milk" }).click(),
  ]);
  // It now offers to uncheck → it is checked. A "Clear checked (1)" control appears.
  await expect(pageA.getByRole("button", { name: "Uncheck Milk" })).toBeVisible();
  await expect(pageA.getByRole("button", { name: /Clear checked \(1\)/ })).toBeVisible();

  // Add a snack, then copy it onto the grocery list.
  const snackAdd = pageA.locator('form[action="/grocery/snack/add"]');
  await snackAdd.locator('input[name="text"]').fill("Pretzels");
  await Promise.all([
    pageA.waitForURL("**/grocery"),
    snackAdd.getByRole("button", { name: "Add" }).click(),
  ]);
  await Promise.all([
    pageA.waitForURL("**/grocery"),
    pageA.getByRole("button", { name: "Add Pretzels to groceries" }).click(),
  ]);
  // Pretzels now appears as a grocery row too (an uncheck/check toggle for it).
  await expect(pageA.getByRole("button", { name: "Check off Pretzels" })).toBeVisible();

  // Clear checked → Milk (the only checked item) disappears from the list.
  await Promise.all([
    pageA.waitForURL("**/grocery"),
    pageA.getByRole("button", { name: /Clear checked/ }).click(),
  ]);
  await expect(pageA.getByRole("button", { name: /Milk/ })).toHaveCount(0);
  // Unchecked items survive.
  await expect(pageA.getByText("Eggs", { exact: true })).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════
test("5. A creates a KID invite; K joins via the link → same household, role kid", async () => {
  await pageA.goto("/settings");
  // Create-invite form: role select defaults to kid. Generate it.
  const inviteForm = pageA.locator('form[action="/settings/invite"]');
  await inviteForm.locator('select[name="role"]').selectOption("kid");
  await Promise.all([
    pageA.waitForURL("**/settings"),
    inviteForm.getByRole("button", { name: "Create link" }).click(),
  ]);

  // The newest invite's URL is in a readonly input alongside a "kid" badge.
  const inviteInput = pageA.locator('input[readonly][value*="/join/"]').first();
  await expect(inviteInput).toBeVisible();
  kidJoinUrl = (await inviteInput.inputValue());
  expect(kidJoinUrl).toContain("/join/");

  // ── K (separate context, phone) joins via the link. ──
  await pageK.goto(kidJoinUrl);
  // The join page confirms the household name and the invite role (kid).
  await expect(pageK.getByText(/You've been invited to join/)).toBeVisible();
  await expect(pageK.getByText("as a kid")).toBeVisible();
  await pageK.getByPlaceholder("Your name").fill(K.name);
  await pageK.getByPlaceholder("Email").fill(K.email);
  await pageK.locator('input[name="password"]').fill(K.password);
  await Promise.all([
    pageK.waitForURL("**/week"),
    pageK.getByRole("button", { name: /Join/ }).click(),
  ]);

  // Kid landed on the week view and sees A's plan (same household).
  await expect(pageK).toHaveURL(/\/week$/);
  await expect(pageK.getByText(POOL_IDEA)).toBeVisible();
  // Kid: no Settings tab (role === kid hides it).
  await expect(pageK.getByRole("link", { name: "Settings" })).toHaveCount(0);
});

// ═══════════════════════════════════════════════════════════════════════════
test("6. Kid can view + add ideas, but cannot mutate plan/grocery/settings (server-enforced)", async () => {
  // ── Kid sees /week + /ideas content. ──
  await pageK.goto("/week");
  await expect(pageK.getByText("Sheet-pan chicken")).toBeVisible();
  // No edit affordances on the week for a kid: no set-slot form, no got-takeout.
  await expect(pageK.locator('form[action="/week/set-slot"]')).toHaveCount(0);
  await expect(pageK.getByRole("button", { name: /We got takeout/ })).toHaveCount(0);

  // Kid CAN add an idea (R3.1).
  await pageK.goto("/ideas");
  await expect(pageK.getByRole("heading", { name: POOL_IDEA })).toBeVisible();
  const kidAdd = pageK.locator('form[action="/ideas/create"]');
  await expect(kidAdd).toBeVisible();
  await kidAdd.locator('input[name="name"]').fill("Mac and cheese");
  await Promise.all([
    pageK.waitForURL("**/ideas"),
    kidAdd.getByRole("button", { name: "Add idea" }).click(),
  ]);
  await expect(pageK.getByRole("heading", { name: "Mac and cheese" })).toBeVisible();

  // Kid sees grocery content but NO edit forms (R1.5 — hidden in UI).
  await pageK.goto("/grocery");
  await expect(pageK.getByText("Eggs", { exact: true })).toBeVisible();
  await expect(pageK.locator('form[action="/grocery/add"]')).toHaveCount(0);
  await expect(pageK.locator('form[action="/grocery/snack/add"]')).toHaveCount(0);

  // ── Server-side enforcement (the real boundary, R1.5). ──
  // /settings GET → 403 for a kid.
  const settingsResp = await pageK.request.get("/settings");
  expect(settingsResp.status()).toBe(403);

  // Direct POST to a mutating route with a PROPER same-origin Origin header →
  // gets past CSRF, then requireAdult returns 403 (not a CSRF 403).
  const origin = new URL(pageK.url()).origin;
  const mutateResp = await pageK.request.post("/week/got-takeout", {
    headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    form: { date: todayIso },
  });
  expect(mutateResp.status()).toBe(403);

  // And the mutation truly did NOT take effect — today's slot is still the
  // unplanned takeout A set, not re-touched. (counter unchanged: 2/2)
  await pageK.goto("/week");
  await expect(pageK.getByText("2 / 2")).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════
test("7. A creates an ADULT invite; B joins → B CAN edit a slot and sees A's data", async () => {
  await pageA.goto("/settings");
  const inviteForm = pageA.locator('form[action="/settings/invite"]');
  await inviteForm.locator('select[name="role"]').selectOption("adult");
  await Promise.all([
    pageA.waitForURL("**/settings"),
    inviteForm.getByRole("button", { name: "Create link" }).click(),
  ]);

  // Grab the adult invite — the one whose row carries the "adult" badge. There are
  // now two invite inputs (kid + adult); pick the adult list item.
  const adultInviteItem = pageA
    .locator("li", { has: pageA.getByText("adult", { exact: true }) })
    .filter({ has: pageA.locator('input[readonly][value*="/join/"]') })
    .first();
  adultJoinUrl = await adultInviteItem.locator('input[readonly]').inputValue();
  expect(adultJoinUrl).toContain("/join/");

  // ── B joins as adult. ──
  await pageB.goto(adultJoinUrl);
  await expect(pageB.getByText("as an adult")).toBeVisible();
  await pageB.getByPlaceholder("Your name").fill(B.name);
  await pageB.getByPlaceholder("Email").fill(B.email);
  await pageB.locator('input[name="password"]').fill(B.password);
  await Promise.all([
    pageB.waitForURL("**/week"),
    pageB.getByRole("button", { name: /Join/ }).click(),
  ]);

  // B sees A's data and HAS the Settings tab (adult).
  await expect(pageB.getByText("Sheet-pan chicken")).toBeVisible();
  await expect(pageB.getByRole("link", { name: "Settings" })).toBeVisible();

  // B edits a slot — proves adult write access for a second user. Pick a day that
  // is neither today (would clobber A's unplanned takeout) nor an already-used
  // day; Saturday is the safe empty slot in this week.
  const sat = weekDates()[6];
  expect(sat).not.toBe(todayIso);
  await planDay(pageB, sat, { text: "Curry (by Blair)", kind: "home" });
  await pageB.goto("/week");
  await expect(pageB.getByText("Curry (by Blair)")).toBeVisible();

  // A sees B's edit too (shared household state).
  await pageA.goto("/week");
  await expect(pageA.getByText("Curry (by Blair)")).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════
test("8. 'Last planned' shows on the pooled idea now that it's planned", async () => {
  // POOL_IDEA was planned on Monday in test 2. Its idea card should now say
  // "Last planned ..." instead of "Never planned".
  await pageA.goto("/ideas");
  const card = pageA.locator("li.mk-card", { has: pageA.getByRole("heading", { name: POOL_IDEA }) });
  await expect(card.getByText(/Last planned/)).toBeVisible();
  await expect(card.getByText("Never planned")).toHaveCount(0);
});

// ═══════════════════════════════════════════════════════════════════════════
test("9. State is consistent across reloads, and log out / log in works", async () => {
  // Reload-consistency: the counter + plans survive a fresh GET.
  await pageA.goto("/week");
  await pageA.reload();
  await expect(pageA.getByText("2 / 2")).toBeVisible();
  await expect(pageA.getByText(POOL_IDEA)).toBeVisible();
  await expect(pageA.getByText("Curry (by Blair)")).toBeVisible();

  // Log out A. The app exposes logout only as POST /logout (no nav button), so
  // drive it as a same-origin request from the page's own session/cookie jar
  // (CSRF guard needs a matching Origin header). The page context's cookies are
  // updated by the Set-Cookie the action returns.
  const origin = new URL(pageA.url()).origin;
  const logoutResp = await pageA.request.post("/logout", { headers: { Origin: origin } });
  // 303 redirect to /login (request API does not auto-follow cross-method redirect
  // bodies, but the Set-Cookie clearing the session is what matters).
  expect([200, 303]).toContain(logoutResp.status());

  // Unauthenticated → /week redirects to /login.
  await pageA.goto("/week");
  await expect(pageA).toHaveURL(/\/login$/);

  // Log back in → straight to /week (household already exists) with state intact.
  await pageA.getByPlaceholder("Email").fill(A.email);
  await pageA.locator('input[name="password"]').fill(A.password);
  await Promise.all([
    pageA.waitForURL("**/week"),
    pageA.getByRole("button", { name: "Log in" }).click(),
  ]);
  await expect(pageA.getByText("2 / 2")).toBeVisible();
  await expect(pageA.getByText("Curry (by Blair)")).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════
test("10. Theme preference: per-user, persists, and lands on <html data-theme>", async () => {
  // Default: follow the OS — no data-theme attribute at all.
  await pageA.goto("/settings");
  await expect(pageA.locator("html")).not.toHaveAttribute("data-theme", /./);

  // Pick Dark in the Appearance section → forced via data-theme on <html>.
  await pageA.getByRole("button", { name: "Dark", exact: true }).click();
  await pageA.waitForURL("**/settings");
  await expect(pageA.locator("html")).toHaveAttribute("data-theme", "dark");

  // It's a USER preference: applies on every page, but not to other users.
  await pageA.goto("/week");
  await expect(pageA.locator("html")).toHaveAttribute("data-theme", "dark");
  await pageB.goto("/week");
  await expect(pageB.locator("html")).not.toHaveAttribute("data-theme", /./);

  // Back to System → attribute gone.
  await pageA.goto("/settings");
  await pageA.getByRole("button", { name: "System", exact: true }).click();
  await pageA.waitForURL("**/settings");
  await expect(pageA.locator("html")).not.toHaveAttribute("data-theme", /./);
});
