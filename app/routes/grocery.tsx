/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Grocery + snack-copy feature module (R4.1–R4.3).
 *
 * OWNERSHIP: owns every /grocery* URL. Filled in WITHOUT touching server.ts. Each
 * URL is a leaf under routes.grocery in app/routes.ts; this controller handles it.
 *
 * Real behaviour = R4.*:
 *  - R4.1 One shared grocery checklist per household: add item, check/uncheck,
 *    delete, "clear checked". Adults only. No generation from meals.
 *  - R4.2 One snack list per week ("have on hand", anchored to the current week
 *    from the household's week_start_day). Adults add/delete; one-tap copies a
 *    snack item's text onto the grocery list.
 *  - R4.3 Checked grocery items persist (struck through) until cleared, so the
 *    shopper can review what's already in the cart.
 *
 * Kids can view everything (R1.5) but every mutation here is requireAdult-guarded
 * server-side; the UI also hides the controls for kids.
 *
 * No-JS by design: every mutation is a plain form POST that 303-redirects back to
 * /grocery (POST-redirect-GET). Check/uncheck is a single-button toggle form, so
 * it works one-handed on a phone without any client JS.
 */
import { createController, type Router } from "remix/router";
import type { AppContext } from "../context.ts";
import { redirect } from "remix/response/redirect";
import * as s from "remix/data-schema";
import * as f from "remix/data-schema/form-data";
import * as coerce from "remix/data-schema/coerce";
import { sql } from "remix/data-table";

import { routes } from "../routes.ts";
import { render } from "../render.tsx";
import { CurrentUserId, requireUser, requireAdult, requireSameOrigin } from "../auth.ts";
import {
  db,
  groceryItems,
  snackItems,
  nowIso,
  type GroceryItem,
  type SnackItem,
} from "../db.ts";
import { GroceryPage } from "../views/grocery-page.tsx";

// ============ WEEK MATH ============
// Snacks are anchored to a week_start_date (R4.2). We derive the CURRENT week's
// start from the household's week_start_day, matching app/routes/week.tsx's
// UTC-midnight convention so the same week resolves to the same anchor string.

const DAY_MS = 24 * 60 * 60 * 1000;

/** A Date as a YYYY-MM-DD string (UTC). */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Current week's start date (YYYY-MM-DD, UTC) for the household's week_start_day. */
function currentWeekStartDate(weekStartDay: number): string {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = today.getUTCDay(); // 0=Sun..6=Sat
  const diff = (dow - weekStartDay + 7) % 7;
  return toIsoDate(new Date(today.getTime() - diff * DAY_MS));
}

// ============ FORM SCHEMAS ============

const textForm = f.object({
  text: f.field(s.defaulted(s.string(), "").transform((v) => v.trim())),
});

// `id` arrives as a form-encoded string; coerce.number parses it (0 on garbage,
// which every handler treats as a no-op).
const idForm = f.object({
  id: f.field(s.defaulted(coerce.number(), 0).transform((n) => (Number.isInteger(n) && n > 0 ? n : 0))),
});

// ============ DATA HELPERS (scoped to household.id) ============

async function listGroceries(householdId: number): Promise<GroceryItem[]> {
  // Unchecked first (created order), then checked (most-recently-checked last) so
  // the live list floats to the top and the struck-through "already got it" pile
  // sits below until cleared.
  return (await db.findMany(groceryItems, {
    where: { household_id: householdId },
    orderBy: ["created_at", "asc"],
  })) as GroceryItem[];
}

async function listSnacks(householdId: number, weekStartDate: string): Promise<SnackItem[]> {
  return (await db.findMany(snackItems, {
    where: { household_id: householdId, week_start_date: weekStartDate },
    orderBy: ["created_at", "asc"],
  })) as SnackItem[];
}

const groceryController = createController(routes.grocery, {
  actions: {
    // GET /grocery — everyone can view (R1.5: kids view everything, read-only).
    async index({ get }) {
      const g = await requireUser(get(CurrentUserId));
      if (!g.ok) return g.response;
      const { household, role } = g.value;

      const weekStart = currentWeekStartDate(household.week_start_day);
      const [items, snacks] = await Promise.all([
        listGroceries(household.id),
        listSnacks(household.id, weekStart),
      ]);

      return render(
        <GroceryPage role={role} items={items} snacks={snacks} weekStart={weekStart} />
      );
    },

    // ── R4.1: add a grocery item (adults only) ──
    add: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        const parsed = s.parseSafe(textForm, get(FormData));
        const text = parsed.success ? parsed.value.text : "";
        if (text) {
          await db.create(groceryItems, {
            household_id: g.value.household.id,
            text,
            created_by: g.value.user.id,
            created_at: nowIso(),
          });
        }
        return redirect(routes.grocery.index.href(), 303);
      },
    },

    // ── R4.1/R4.3: check/uncheck a grocery item (adults only) ──
    // Toggle is a single POST: if checked_at is null we stamp it, else we clear it.
    // db.update can't write SQL NULL (TableRow types omit null), so both branches
    // use the raw `sql` escape hatch. Tenancy is enforced in the WHERE clause.
    toggle: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        const parsed = s.parseSafe(idForm, get(FormData));
        const id = parsed.success ? parsed.value.id : 0;
        if (id > 0) {
          await db.exec(sql`
            UPDATE grocery_items
            SET checked_at = CASE WHEN checked_at IS NULL THEN ${nowIso()} ELSE NULL END
            WHERE id = ${id} AND household_id = ${g.value.household.id}
          `);
        }
        return redirect(routes.grocery.index.href(), 303);
      },
    },

    // ── R4.1: delete a single grocery item (adults only) ──
    remove: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        const parsed = s.parseSafe(idForm, get(FormData));
        const id = parsed.success ? parsed.value.id : 0;
        if (id > 0) {
          // Scoped delete: only removes the row if it belongs to this household.
          await db.exec(
            sql`DELETE FROM grocery_items WHERE id = ${id} AND household_id = ${g.value.household.id}`
          );
        }
        return redirect(routes.grocery.index.href(), 303);
      },
    },

    // ── R4.1: clear all checked items at once (adults only) ──
    clearChecked: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        await db.exec(
          sql`DELETE FROM grocery_items WHERE household_id = ${g.value.household.id} AND checked_at IS NOT NULL`
        );
        return redirect(routes.grocery.index.href(), 303);
      },
    },

    // ── R4.2: add a snack item for the current week (adults only) ──
    addSnack: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        const parsed = s.parseSafe(textForm, get(FormData));
        const text = parsed.success ? parsed.value.text : "";
        if (text) {
          await db.create(snackItems, {
            household_id: g.value.household.id,
            week_start_date: currentWeekStartDate(g.value.household.week_start_day),
            text,
            created_by: g.value.user.id,
            created_at: nowIso(),
          });
        }
        return redirect(routes.grocery.index.href(), 303);
      },
    },

    // ── R4.2: delete a snack item (adults only) ──
    removeSnack: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        const parsed = s.parseSafe(idForm, get(FormData));
        const id = parsed.success ? parsed.value.id : 0;
        if (id > 0) {
          await db.exec(
            sql`DELETE FROM snack_items WHERE id = ${id} AND household_id = ${g.value.household.id}`
          );
        }
        return redirect(routes.grocery.index.href(), 303);
      },
    },

    // ── R4.2: one-tap copy a snack item's text onto the grocery list (adults). ──
    // We read the snack (scoped to the household) and create a new grocery row from
    // its text. The snack stays put — copy, not move.
    copySnack: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        const parsed = s.parseSafe(idForm, get(FormData));
        const id = parsed.success ? parsed.value.id : 0;
        if (id > 0) {
          const snack = (await db.findOne(snackItems, {
            where: { id, household_id: g.value.household.id },
          })) as SnackItem | undefined;
          if (snack) {
            await db.create(groceryItems, {
              household_id: g.value.household.id,
              text: snack.text,
              created_by: g.value.user.id,
              created_at: nowIso(),
            });
          }
        }
        return redirect(routes.grocery.index.href(), 303);
      },
    },
  },
});

export function registerRoutes(router: Router<AppContext>): void {
  router.map(routes.grocery, groceryController);
}
